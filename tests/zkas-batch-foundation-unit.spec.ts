import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ZKasBatchJournal } from "@/lib/zkas/batch-journal";
import {
  ZKasBatchClient,
  ZKasBatchCapabilityClient,
  type ZKasPreparedBatch,
} from "@/lib/zkas/batch-client";
import { ZKasPaymentJournal } from "@/lib/zkas/payment-journal";
import { ZKasBatchPayment } from "@/lib/zkas/batch-payment";

const selection = {
  walletId: "wallet",
  accountIndex: 0,
  network: "mainnet" as const,
};
const intent = {
  selection,
  account: "zkas:" + "a".repeat(80),
  genesis: "1".repeat(64),
  origin: "https://example.test",
  logicalId: "2".repeat(64),
  outputs: [
    {
      recipient: "zkas:" + "b".repeat(80),
      amountSompi: "1",
      memoHex: "00".repeat(512),
    },
  ],
  maxFeeSompi: "1000000",
};

function store() {
  let value: unknown = null;
  return {
    getValue: async <T>() => structuredClone(value) as T | null,
    updateValue: async <T>(
      _key: string,
      update: (current: T | null) => T | Promise<T>,
    ) => {
      value = structuredClone(await update(value as T | null));
    },
  };
}

async function signedFixture() {
  const transactionHex = "ab".repeat(100);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(100).fill(0xab),
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { transactionHex, txid: "3".repeat(64), sha256 };
}

test("verified full signed bytes survive restart and uncertain retry without new intent", async () => {
  const persisted = store();
  const first = new ZKasBatchJournal(persisted, async () => false);
  await first.reserve(intent);
  const signed = await signedFixture();
  await first.saveFinalized(intent, signed);
  await first.markUnknown(intent.logicalId);
  const restarted = new ZKasBatchJournal(persisted, async () => false);
  const record = await restarted.get(intent.logicalId);
  expect(record?.transactionHex).toBe("ab".repeat(100));
  expect(record?.status).toBe("unknown");
  await expect(
    restarted.reserve({ ...intent, logicalId: "5".repeat(64) }),
  ).rejects.toThrow(/unresolved/i);
  await expect(
    restarted.saveFinalized(intent, { ...signed, transactionHex: "cd" }),
  ).rejects.toThrow();
});

test("private journal rejects mismatched transaction digest before persistence", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  await expect(
    journal.saveFinalized(intent, {
      ...(await signedFixture()),
      sha256: "4".repeat(64),
    }),
  ).rejects.toThrow(/digest/i);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("uncertain grant retry reuses the exact unsent logical intent", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  await journal.reserve(structuredClone(intent));
  await expect(
    journal.reserve({ ...intent, maxFeeSompi: "1000001" }),
  ).rejects.toThrow(/changed|unresolved/i);
});

test("batch client sends no wallet token on capability preparation and rejects oversized response", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new ZKasBatchCapabilityClient({
    baseUrl: "http://127.0.0.1:8080",
    origin: intent.origin,
    currentOrigin: () => intent.origin,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ status: "in_progress", logicalId: intent.logicalId }),
        { status: 200 },
      );
    },
  });
  await client.prepare("b".repeat(64), intent.logicalId);
  expect(calls[0].url).toBe("http://127.0.0.1:8080/api/wallet/prepare-many");
  expect(new Headers(calls[0].init.headers).has("X-Wallet-Token")).toBe(false);
  expect(new Headers(calls[0].init.headers).has("Origin")).toBe(false);
  expect(calls[0].init.body).toBeUndefined();
  const changedOrigin = new ZKasBatchCapabilityClient({
    baseUrl: "http://127.0.0.1:8080",
    origin: intent.origin,
    currentOrigin: () => "https://other.test",
    fetch: async () => {
      throw new Error("must not fetch");
    },
  });
  await expect(
    changedOrigin.prepare("b".repeat(64), intent.logicalId),
  ).rejects.toThrow(/origin changed/i);
  const oversized = new ZKasBatchClient({
    baseUrl: "http://127.0.0.1:8080",
    token: "a".repeat(32),
    fetch: async () => new Response("x".repeat(2_000_001)),
  });
  await expect(oversized.prepared(intent.logicalId)).rejects.toThrow(
    /too large/i,
  );
});

test("credentialed grant sends only the exact approved intent to configured daemon", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          capability: "b".repeat(64),
          logicalId: intent.logicalId,
          expiresAtUnix: 2_000_000_000,
        }),
      );
    },
  });
  await client.grant(intent);
  expect(calls[0].url).toBe(
    "https://wallet.example.test/api/wallet/prepare-many/capability",
  );
  expect(new Headers(calls[0].init.headers).get("X-Wallet-Token")).toBe(
    "a".repeat(32),
  );
  expect(JSON.parse(String(calls[0].init.body))).toEqual({
    origin: intent.origin,
    account: intent.account,
    genesis: intent.genesis,
    logicalId: intent.logicalId,
    outputs: intent.outputs,
    maxFeeSompi: intent.maxFeeSompi,
  });
  expect(
    () =>
      new ZKasBatchClient({
        baseUrl: "http://wallet.example.test",
        token: "a".repeat(32),
      }),
  ).toThrow(/URL/i);
});

test("credentialed batch reads use the daemon's exact camel-case query contract", async () => {
  const signed = await signedFixture();
  const queries: Array<{ path: string; keys: string[] }> = [];
  const client = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async (url) => {
      const parsed = new URL(String(url));
      queries.push({
        path: parsed.pathname,
        keys: [...parsed.searchParams.keys()].sort(),
      });
      let body: unknown;
      if (parsed.pathname === "/api/wallet/prepare-many")
        body = { status: "in_progress", logicalId: intent.logicalId };
      else if (parsed.pathname === "/api/wallet/finalize-many/journal")
        body = { status: "finalized", logicalId: intent.logicalId, ...signed };
      else
        body = {
          status: "unknown",
          logicalId: intent.logicalId,
          txid: signed.txid,
          sha256: signed.sha256,
        };
      return new Response(JSON.stringify(body));
    },
  });
  await client.prepared(intent.logicalId);
  await client.finalizedJournal(intent);
  await client.status(intent);
  expect(queries).toEqual([
    { path: "/api/wallet/prepare-many", keys: ["logicalId"] },
    {
      path: "/api/wallet/finalize-many/journal",
      keys: ["account", "genesis", "logicalId"],
    },
    {
      path: "/api/wallet/submit-many/status",
      keys: ["account", "genesis", "logicalId"],
    },
  ]);
});

test("prepared response preserves a real SDK V3 envelope and rejects malformed accounts", async () => {
  // Public dummy envelope extracted from ZKas SDK browser-signer v3-payment.json.
  const envelope = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-v3-prepared.json", import.meta.url),
      "utf8",
    ),
  );
  const response = (preparedPayment: unknown) =>
    new Response(
      JSON.stringify({
        status: "prepared",
        logicalId: intent.logicalId,
        session: "6".repeat(48),
        preparedPayment,
      }),
    );
  const client = (preparedPayment: unknown) =>
    new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async () => response(preparedPayment),
    });
  const prepared = await client(envelope).prepared(intent.logicalId);
  expect(prepared.preparedPayment).toEqual(envelope);
  expect(prepared.preparedPayment?.account).toBe(envelope.account);
  for (const account of [
    "00".repeat(43),
    "zkas:UPPERCASE",
    `zkas:${"a".repeat(121)}`,
    "zkas:bad/path",
  ]) {
    await expect(
      client({ ...envelope, account }).prepared(intent.logicalId),
    ).rejects.toThrow();
  }
  const changedChecksum = { ...envelope, checksum: "0".repeat(64) };
  expect(
    (await client(changedChecksum).prepared(intent.logicalId)).preparedPayment,
  ).toEqual(changedChecksum);
});

test("credentialed request deadline covers a stalled response body", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, _delay?: number) =>
    originalSetTimeout(callback, 20)) as typeof setTimeout;
  try {
    const client = new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new Error("body aborted")),
              );
            },
          }),
        ),
    });
    const result = await Promise.race([
      client.prepared(intent.logicalId).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) =>
        originalSetTimeout(() => resolve("hung"), 150),
      ),
    ]);
    expect(result).toBe("rejected");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("credentialed request accepts a body completed before its deadline", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, _delay?: number) =>
    originalSetTimeout(callback, 80)) as typeof setTimeout;
  try {
    const client = new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              originalSetTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      status: "in_progress",
                      logicalId: intent.logicalId,
                    }),
                  ),
                );
                controller.close();
              }, 10);
            },
          }),
        ),
    });
    expect((await client.prepared(intent.logicalId)).status).toBe(
      "in_progress",
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("legacy and batch reservations cannot overlap when requests race", async () => {
  const persisted = store();
  let localValue: unknown = null;
  const local = {
    getItem: async <T>() => structuredClone(localValue) as T | null,
    setItem: async <T>(_key: string, value: T) => {
      localValue = structuredClone(value);
    },
  };
  const batch: ZKasBatchJournal = new ZKasBatchJournal(
    persisted,
    async () => !!(await legacy.get(selection)),
  );
  const legacy: ZKasPaymentJournal = new ZKasPaymentJournal(
    local,
    Date.now,
    async () => batch.hasReservation(selection),
  );
  const results = await Promise.allSettled([
    batch.reserve(intent),
    legacy.acquire(selection),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
});

test("private signer verifies full bytes before journal write and journal is uncertain before submit", async () => {
  const events: string[] = [];
  const journal = new ZKasBatchJournal(store(), async () => false);
  const signed = await signedFixture();
  const daemon = {
    grant: async () => ({
      capability: "5".repeat(64),
      logicalId: intent.logicalId,
      expiresAtUnix: 2000000000,
    }),
    prepared: async () =>
      ({
        status: "prepared",
        logicalId: intent.logicalId,
        session: "6".repeat(48),
        preparedPayment: { version: 3 },
      }) as ZKasPreparedBatch,
    finalize: async () => {
      events.push("finalize");
      return signed;
    },
    finalizedJournal: async () => signed,
    submit: async () => {
      events.push("submit");
      expect((await journal.get(intent.logicalId))?.status).toBe("unknown");
      return {
        status: "unknown" as const,
        logicalId: intent.logicalId,
        txid: signed.txid,
        sha256: signed.sha256,
      };
    },
  };
  const flow = new ZKasBatchPayment(daemon, journal, async () => {
    events.push("selection");
  });
  await flow.begin(intent);
  const handle = {
    sign: async () => {
      events.push("sign");
      return [{ actionIndex: 0, signatureHex: "7".repeat(128) }];
    },
    verifyFinalized: async () => {
      events.push("verify");
    },
  };
  await flow.complete(intent, async () => handle);
  expect(events.indexOf("verify")).toBeLessThan(events.indexOf("submit"));
  expect((await journal.get(intent.logicalId))?.transactionHex).toBe(
    signed.transactionHex,
  );
});

test("failed full transaction verification cannot persist or submit finalized bytes", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  let submitted = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: intent.logicalId,
        expiresAtUnix: 2000000000,
      }),
      prepared: async () =>
        ({
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: { version: 3 },
        }) as ZKasPreparedBatch,
      finalize: async () => signedFixture(),
      finalizedJournal: async () => signedFixture(),
      submit: async () => {
        submitted = true;
        throw new Error("must not submit");
      },
    },
    journal,
    async () => undefined,
  );
  await expect(
    flow.complete(intent, async () => ({
      sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
      verifyFinalized: async () => {
        throw new Error("invalid proof");
      },
    })),
  ).rejects.toThrow(/invalid proof/);
  expect(submitted).toBe(false);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("lost finalize response refetches daemon journal while the private handle survives", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  const signed = await signedFixture();
  let verified = false;
  let submitted = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: intent.logicalId,
        expiresAtUnix: 2000000000,
      }),
      prepared: async () =>
        ({
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: { version: 3 },
        }) as ZKasPreparedBatch,
      finalize: async () => {
        throw new Error("response lost");
      },
      finalizedJournal: async () => signed,
      submit: async () => {
        submitted = true;
        expect(verified).toBe(true);
        return {
          status: "unknown" as const,
          logicalId: intent.logicalId,
          txid: signed.txid,
          sha256: signed.sha256,
        };
      },
    },
    journal,
    async () => undefined,
  );
  await flow.complete(intent, async () => ({
    sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
    verifyFinalized: async () => {
      verified = true;
    },
  }));
  expect(submitted).toBe(true);
  expect((await journal.get(intent.logicalId))?.transactionHex).toBe(
    signed.transactionHex,
  );
});

test("submission timeout keeps exact bytes and retries without reopening signer", async () => {
  const persisted = store();
  const first = new ZKasBatchJournal(persisted, async () => false);
  await first.reserve(intent);
  const signed = await signedFixture();
  await first.saveFinalized(intent, signed);
  let attempts = 0;
  const daemon = {
    grant: async () => {
      throw new Error("must not grant");
    },
    prepared: async () => {
      throw new Error("must not prove");
    },
    finalize: async () => {
      throw new Error("must not finalize");
    },
    finalizedJournal: async () => {
      throw new Error("must not refetch");
    },
    submit: async (_approved: unknown, exact: typeof signed) => {
      attempts += 1;
      expect(exact).toEqual(signed);
      if (attempts === 1) throw new Error("transport timeout");
      return {
        status: "unknown" as const,
        logicalId: intent.logicalId,
        txid: signed.txid,
        sha256: signed.sha256,
      };
    },
  };
  const flow = new ZKasBatchPayment(daemon, first, async () => undefined);
  await expect(flow.retryStored(intent)).rejects.toThrow(/timeout/);
  const restarted = new ZKasBatchPayment(
    daemon,
    new ZKasBatchJournal(persisted, async () => false),
    async () => undefined,
  );
  expect((await restarted.retryStored(intent)).txid).toBe(signed.txid);
  expect(attempts).toBe(2);
});

test("selection change after prepared refetch prevents opening the private signer", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  let selectionChanged = false;
  let opened = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        selectionChanged = true;
        return {
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: { version: 3 },
        } as ZKasPreparedBatch;
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not recover");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    journal,
    async () => {
      if (selectionChanged) throw new Error("selected account changed");
    },
  );
  await expect(
    flow.complete(intent, async () => {
      opened = true;
      throw new Error("must not open");
    }),
  ).rejects.toThrow(/selected account changed/);
  expect(opened).toBe(false);
});

test("selection change during journal read prevents credentialed prepared refetch", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  const originalGet = journal.get.bind(journal);
  let stale = false;
  journal.get = async (logicalId) => {
    const result = await originalGet(logicalId);
    stale = true;
    return result;
  };
  let preparedReads = 0;
  let opened = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        preparedReads++;
        throw new Error("must not refetch");
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not recover");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    journal,
    async () => {
      if (stale) throw new Error("selected account changed");
    },
  );
  await expect(
    flow.complete(intent, async () => {
      opened = true;
      throw new Error("must not open");
    }),
  ).rejects.toThrow(/selected account changed/);
  expect(preparedReads).toBe(0);
  expect(opened).toBe(false);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("selection change during stored-byte read cannot mark the payment UNKNOWN", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  const signed = await signedFixture();
  await journal.saveFinalized(intent, signed);
  const originalGet = journal.get.bind(journal);
  let stale = false;
  journal.get = async (logicalId) => {
    const result = await originalGet(logicalId);
    stale = true;
    return result;
  };
  let submitted = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        throw new Error("must not prepare");
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not recover");
      },
      submit: async () => {
        submitted = true;
        throw new Error("must not submit");
      },
    },
    journal,
    async () => {
      if (stale) throw new Error("selected account changed");
    },
  );
  await expect(flow.retryStored(intent)).rejects.toThrow(
    /selected account changed/,
  );
  expect(submitted).toBe(false);
  expect((await originalGet(intent.logicalId))?.status).toBe("finalized");
});

test("selection change during rejected finalization prevents credentialed recovery read", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  let stale = false;
  let recoveryReads = 0;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () =>
        ({
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: { version: 3 },
        }) as ZKasPreparedBatch,
      finalize: async () => {
        stale = true;
        throw new Error("response lost");
      },
      finalizedJournal: async () => {
        recoveryReads++;
        return signedFixture();
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    journal,
    async () => {
      if (stale) throw new Error("selected account changed");
    },
  );
  await expect(
    flow.complete(intent, async () => ({
      sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
      verifyFinalized: async () => undefined,
    })),
  ).rejects.toThrow(/selected account changed/);
  expect(recoveryReads).toBe(0);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("selection change during successful finalization prevents private verification", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  let stale = false;
  let verified = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () =>
        ({
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: { version: 3 },
        }) as ZKasPreparedBatch,
      finalize: async () => {
        stale = true;
        return signedFixture();
      },
      finalizedJournal: async () => {
        throw new Error("must not recover");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    journal,
    async () => {
      if (stale) throw new Error("selected account changed");
    },
  );
  await expect(
    flow.complete(intent, async () => ({
      sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
      verifyFinalized: async () => {
        verified = true;
      },
    })),
  ).rejects.toThrow(/selected account changed/);
  expect(verified).toBe(false);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("selection change during submit rejects completion and retains exact UNKNOWN bytes", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  const signed = await signedFixture();
  await journal.saveFinalized(intent, signed);
  let stale = false;
  const flow = new ZKasBatchPayment(
    {
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        throw new Error("must not prepare");
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not recover");
      },
      submit: async () => {
        stale = true;
        return {
          status: "unknown" as const,
          logicalId: intent.logicalId,
          txid: signed.txid,
          sha256: signed.sha256,
        };
      },
    },
    journal,
    async () => {
      if (stale) throw new Error("selected account changed");
    },
  );
  await expect(flow.retryStored(intent)).rejects.toThrow(
    /selected account changed/,
  );
  expect(await journal.get(intent.logicalId)).toMatchObject({
    status: "unknown",
    transactionHex: signed.transactionHex,
    txid: signed.txid,
    sha256: signed.sha256,
  });
});
