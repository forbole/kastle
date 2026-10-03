import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  BATCH_JOURNAL_KEY,
  ZKasBatchJournal,
  type ZKasBatchIntent,
  type ZKasBatchRecord,
} from "@/lib/zkas/batch-journal";
import {
  ZKasBatchClient,
  ZKasBatchCapabilityClient,
  type ZKasPreparedBatch,
  type ZKasBatchInventory,
  type ZKasBatchSendStatus,
} from "@/lib/zkas/batch-client";
import { ZKasPaymentJournal } from "@/lib/zkas/payment-journal";
import {
  ZKasBatchPayment,
  type PrivateBatchSigner,
} from "@/lib/zkas/batch-payment";

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

function recoveryFixture() {
  const preparedPayment = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-v3-prepared.json", import.meta.url),
      "utf8",
    ),
  );
  const approved = {
    ...intent,
    account: preparedPayment.account as string,
    outputs: preparedPayment.outputs.map(
      (output: { recipient: string; amount: string; memo: string }) => ({
        recipient: output.recipient,
        amountSompi: output.amount,
        memoHex: output.memo,
      }),
    ),
    maxFeeSompi: "3000000",
  };
  const signatures = [{ actionIndex: 0, signatureHex: "7".repeat(128) }];
  const signedTicket = JSON.stringify({
    format: "zkas-private-signed-payment",
    version: 1,
    approvalDigest: "8".repeat(64),
    prepared: preparedPayment,
    signatures,
  });
  return { approved, preparedPayment, signatures, signedTicket };
}

function preparedForFoundationIntent() {
  const { preparedPayment } = recoveryFixture();
  return {
    ...preparedPayment,
    account: intent.account,
    outputs: intent.outputs.map((output) => ({
      amount: output.amountSompi,
      memo: output.memoHex,
      recipient: output.recipient,
    })),
    fee: intent.maxFeeSompi,
  };
}

function ticketForFoundationIntent() {
  return JSON.stringify({
    format: "zkas-private-signed-payment",
    version: 1,
    approvalDigest: "8".repeat(64),
    prepared: preparedForFoundationIntent(),
    signatures: [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
  });
}

async function saveFoundationTicket(journal: ZKasBatchJournal) {
  await journal.saveSignedTicket(intent, {
    signedTicket: ticketForFoundationIntent(),
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: preparedForFoundationIntent().checksum,
    signatures: [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
  });
}

test("verified full signed bytes survive restart and uncertain retry without new intent", async () => {
  const persisted = store();
  const first = new ZKasBatchJournal(persisted, async () => false);
  await first.reserve(intent);
  await saveFoundationTicket(first);
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

test("literal HTTP loopback origins preserve exact browser binding and an empty credential-free prepare", async () => {
  for (const origin of [
    "http://localhost:1",
    "http://localhost:8765",
    "http://localhost:65535",
    "http://127.0.0.1:8765",
  ]) {
    const localIntent = { ...intent, origin };
    const journal = new ZKasBatchJournal(store(), async () => false);
    await journal.reserve(localIntent);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new ZKasBatchCapabilityClient({
      baseUrl: "https://wallet.example.test",
      origin,
      currentOrigin: () => origin,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            status: "in_progress",
            logicalId: intent.logicalId,
          }),
        );
      },
    });
    await client.prepare("b".repeat(64), intent.logicalId);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.credentials).toBe("omit");
    expect(new Headers(calls[0].init.headers).has("X-Wallet-Token")).toBe(
      false,
    );
    expect(new Headers(calls[0].init.headers).has("Origin")).toBe(false);
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe(
      `Batch ${"b".repeat(64)}`,
    );
    let grantedOrigin = "";
    const credentialed = new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async (_url, init) => {
        grantedOrigin = JSON.parse(String(init?.body)).origin;
        return new Response(
          JSON.stringify({
            capability: "b".repeat(64),
            logicalId: intent.logicalId,
            expiresAtUnix: 2_000_000_000,
          }),
        );
      },
    });
    await credentialed.grant(localIntent);
    expect(grantedOrigin).toBe(origin);
  }
  let called = false;
  const mismatched = new ZKasBatchCapabilityClient({
    baseUrl: "https://wallet.example.test",
    origin: "http://localhost:8765",
    currentOrigin: () => "http://127.0.0.1:8765",
    fetch: async () => {
      called = true;
      throw new Error("must not fetch");
    },
  });
  await expect(
    mismatched.prepare("b".repeat(64), intent.logicalId),
  ).rejects.toThrow(/origin changed/i);
  expect(called).toBe(false);
});

test("HTTP application origins reject aliases, noncanonical ports, and URL suffixes", async () => {
  for (const origin of [
    "http://localhost",
    "http://localhost:80",
    "http://localhost:0",
    "http://localhost:0001",
    "http://localhost:65536",
    "http://LOCALHOST:8765",
    "http://localhost.local:8765",
    "http://127.1:8765",
    "http://[::1]:8765",
    "http://10.0.0.1:8765",
    "http://user@localhost:8765",
    "http://localhost:8765/",
    "http://localhost:8765?x=1",
    "http://localhost:8765#hash",
  ]) {
    expect(
      () =>
        new ZKasBatchCapabilityClient({
          baseUrl: "https://wallet.example.test",
          origin,
          currentOrigin: () => origin,
          fetch: async () => {
            throw new Error("must not fetch");
          },
        }),
      origin,
    ).toThrow(/origin/i);
    await expect(
      new ZKasBatchJournal(store(), async () => false).reserve({
        ...intent,
        origin,
      }),
      origin,
    ).rejects.toThrow(/origin/i);
  }
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

function discoveryEntry(index: number) {
  return {
    logicalId: index.toString(16).padStart(64, "0"),
    revision: 1,
    status: "unknown",
    txid: "3".repeat(64),
    sha256: "4".repeat(64),
  };
}

test("credentialed discovery gathers exact ordered pages from the configured daemon", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const entries = Array.from({ length: 33 }, (_, index) =>
    discoveryEntry(index),
  );
  const client = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed, init: init ?? {} });
      const offset = parsed.searchParams.has("afterLogicalId") ? 32 : 0;
      return new Response(
        JSON.stringify({
          inventoryOnly: true,
          epoch: "5".repeat(64),
          entries: entries.slice(offset, offset + 32),
          ...(offset === 0
            ? { nextAfterLogicalId: entries[31].logicalId }
            : {}),
          unlistedReservationCount: 2,
        }),
      );
    },
  });
  const result = await client.discoverRecords({
    account: intent.account,
    genesis: intent.genesis,
  });
  expect(result.entries).toEqual(entries);
  expect(result.epoch).toBe("5".repeat(64));
  expect(result.unlistedReservationCount).toBe(2);
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.url.origin).toBe("https://wallet.example.test");
    expect(call.url.pathname).toBe("/api/wallet/submit-many/records");
    expect(call.url.searchParams.get("account")).toBe(intent.account);
    expect(call.url.searchParams.get("genesis")).toBe(intent.genesis);
    expect(new Headers(call.init.headers).get("X-Wallet-Token")).toBe(
      "a".repeat(32),
    );
    expect(new Headers(call.init.headers).has("Authorization")).toBe(false);
    expect(call.init.body).toBeUndefined();
  }
  expect([...calls[0].url.searchParams.keys()].sort()).toEqual([
    "account",
    "genesis",
  ]);
  expect(calls[1].url.searchParams.get("afterLogicalId")).toBe(
    entries[31].logicalId,
  );
  expect(calls[1].url.searchParams.get("epoch")).toBe("5".repeat(64));
});

test("credentialed discovery covers the full 4096 record bound", async () => {
  const entries = Array.from({ length: 4096 }, (_, index) =>
    discoveryEntry(index),
  );
  let calls = 0;
  const client = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async (url) => {
      const parsed = new URL(String(url));
      const after = parsed.searchParams.get("afterLogicalId");
      const offset = after ? Number.parseInt(after, 16) + 1 : 0;
      calls++;
      return new Response(
        JSON.stringify({
          inventoryOnly: true,
          epoch: "5".repeat(64),
          entries: entries.slice(offset, offset + 32),
          ...(offset + 32 < entries.length
            ? { nextAfterLogicalId: entries[offset + 31].logicalId }
            : {}),
          unlistedReservationCount: 0,
        }),
      );
    },
  });
  const result = await client.discoverRecords({
    account: intent.account,
    genesis: intent.genesis,
  });
  expect(calls).toBe(128);
  expect(result.entries).toEqual(entries);
  const overflow = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async (url) => {
      const after = new URL(String(url)).searchParams.get("afterLogicalId");
      const offset = after ? Number.parseInt(after, 16) + 1 : 0;
      return new Response(
        JSON.stringify({
          inventoryOnly: true,
          epoch: "5".repeat(64),
          entries: entries.slice(offset, offset + 32),
          nextAfterLogicalId: entries[offset + 31].logicalId,
          unlistedReservationCount: 0,
        }),
      );
    },
  });
  await expect(
    overflow.discoverRecords({
      account: intent.account,
      genesis: intent.genesis,
    }),
  ).rejects.toThrow(/bound|cursor/i);
});

test("credentialed discovery rejects malformed, unstable, and unsafe inventory", async () => {
  const base = {
    inventoryOnly: true,
    epoch: "5".repeat(64),
    entries: [discoveryEntry(0)],
    unlistedReservationCount: 0,
  };
  for (const altered of [
    { ...base, inventoryOnly: false },
    { ...base, extra: true },
    { ...base, entries: [{ ...discoveryEntry(0), revision: 2 ** 53 }] },
    { ...base, entries: [{ ...discoveryEntry(0), includedDaa: 2 ** 53 }] },
    {
      ...base,
      entries: Array.from({ length: 33 }, (_, index) => discoveryEntry(index)),
    },
    { ...base, entries: [discoveryEntry(1), discoveryEntry(1)] },
    { ...base, entries: [discoveryEntry(1), discoveryEntry(0)] },
    { ...base, entries: [{ ...discoveryEntry(0), extra: true }] },
    { ...base, entries: [discoveryEntry(0)], unlistedReservationCount: 4097 },
    { ...base, entries: [discoveryEntry(0)], unlistedReservationCount: 4096 },
    { ...base, entries: [discoveryEntry(0)], unlistedReservationCount: -1 },
    { ...base, entries: [discoveryEntry(0)], epoch: "A".repeat(64) },
    {
      ...base,
      entries: [discoveryEntry(0)],
      nextAfterLogicalId: "9".repeat(64),
    },
  ]) {
    const client = new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async () => new Response(JSON.stringify(altered)),
    });
    await expect(
      client.discoverRecords({
        account: intent.account,
        genesis: intent.genesis,
      }),
    ).rejects.toThrow();
  }
});

test("credentialed discovery fails closed on epoch or count change and HTTP 409", async () => {
  for (const change of ["epoch", "count", "conflict"]) {
    let calls = 0;
    const client = new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async () => {
        calls++;
        if (calls === 2 && change === "conflict")
          return new Response("inventory changed", { status: 409 });
        return new Response(
          JSON.stringify({
            inventoryOnly: true,
            epoch: (calls === 2 && change === "epoch" ? "6" : "5").repeat(64),
            entries:
              calls === 1
                ? Array.from({ length: 32 }, (_, index) =>
                    discoveryEntry(index),
                  )
                : [discoveryEntry(32)],
            ...(calls === 1
              ? { nextAfterLogicalId: discoveryEntry(31).logicalId }
              : {}),
            unlistedReservationCount: calls === 2 && change === "count" ? 1 : 0,
          }),
        );
      },
    });
    await expect(
      client.discoverRecords({
        account: intent.account,
        genesis: intent.genesis,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  }
});

test("credentialed discovery rejects overlap and premature continuation", async () => {
  for (const secondEntries of [
    [discoveryEntry(31)],
    [discoveryEntry(30), discoveryEntry(32)],
  ]) {
    let calls = 0;
    const client = new ZKasBatchClient({
      baseUrl: "https://wallet.example.test",
      token: "a".repeat(32),
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            inventoryOnly: true,
            epoch: "5".repeat(64),
            entries:
              calls === 1
                ? Array.from({ length: 32 }, (_, index) =>
                    discoveryEntry(index),
                  )
                : secondEntries,
            ...(calls === 1
              ? { nextAfterLogicalId: discoveryEntry(31).logicalId }
              : {}),
            unlistedReservationCount: 0,
          }),
        );
      },
    });
    await expect(
      client.discoverRecords({
        account: intent.account,
        genesis: intent.genesis,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  }
  const shortPage = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async () =>
      new Response(
        JSON.stringify({
          inventoryOnly: true,
          epoch: "5".repeat(64),
          entries: [discoveryEntry(0)],
          nextAfterLogicalId: discoveryEntry(0).logicalId,
          unlistedReservationCount: 0,
        }),
      ),
  });
  await expect(
    shortPage.discoverRecords({
      account: intent.account,
      genesis: intent.genesis,
    }),
  ).rejects.toThrow(/cursor/i);
});

test("credentialed discovery rejects an empty terminal continuation", async () => {
  let calls = 0;
  const client = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          inventoryOnly: true,
          epoch: "5".repeat(64),
          entries:
            calls === 1
              ? Array.from({ length: 32 }, (_, index) => discoveryEntry(index))
              : [],
          ...(calls === 1
            ? { nextAfterLogicalId: discoveryEntry(31).logicalId }
            : {}),
          unlistedReservationCount: 0,
        }),
      );
    },
  });
  await expect(
    client.discoverRecords({
      account: intent.account,
      genesis: intent.genesis,
    }),
  ).rejects.toThrow(/empty|continuation|cursor/i);
  expect(calls).toBe(2);
});

test("credentialed discovery bounds stalled body reads", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler) =>
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
                controller.error(new Error("discovery body aborted")),
              );
            },
          }),
        ),
    });
    const outcome = await Promise.race([
      client
        .discoverRecords({
          account: intent.account,
          genesis: intent.genesis,
        })
        .then(
          () => "resolved",
          () => "rejected",
        ),
      new Promise<string>((resolve) =>
        originalSetTimeout(() => resolve("hung"), 150),
      ),
    ]);
    expect(outcome).toBe("rejected");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("credentialed discovery returns a positive opaque barrier without clearing it", async () => {
  const client = new ZKasBatchClient({
    baseUrl: "https://wallet.example.test",
    token: "a".repeat(32),
    fetch: async () =>
      new Response(
        JSON.stringify({
          inventoryOnly: true,
          epoch: "5".repeat(64),
          entries: [],
          unlistedReservationCount: 1,
        }),
      ),
  });
  const result = await client.discoverRecords({
    account: intent.account,
    genesis: intent.genesis,
  });
  expect(result.entries).toEqual([]);
  expect(result.unlistedReservationCount).toBe(1);
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
    identity: "https://wallet.example.test",
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
        preparedPayment: preparedForFoundationIntent(),
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
    exportTicket: async () => ticketForFoundationIntent(),
    importTicket: async () => undefined,
    close: () => undefined,
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
  let submitted = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
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
          preparedPayment: preparedForFoundationIntent(),
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
  await flow.begin(intent);
  await expect(
    flow.complete(intent, async () => ({
      sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
      exportTicket: async () => ticketForFoundationIntent(),
      importTicket: async () => undefined,
      close: () => undefined,
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
  const signed = await signedFixture();
  let verified = false;
  let submitted = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
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
          preparedPayment: preparedForFoundationIntent(),
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
  await flow.begin(intent);
  await flow.complete(intent, async () => ({
    sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
    exportTicket: async () => ticketForFoundationIntent(),
    importTicket: async () => undefined,
    close: () => undefined,
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
  await saveFoundationTicket(first);
  const signed = await signedFixture();
  await first.saveFinalized(intent, signed);
  let attempts = 0;
  const daemon = {
    identity: "https://wallet.example.test",
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
  let selectionChanged = false;
  let opened = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: intent.logicalId,
        expiresAtUnix: 2_000_000_000,
      }),
      prepared: async () => {
        selectionChanged = true;
        return {
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: preparedForFoundationIntent(),
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
  await flow.begin(intent);
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
      identity: "https://wallet.example.test",
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
  await saveFoundationTicket(journal);
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
      identity: "https://wallet.example.test",
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
  let stale = false;
  let recoveryReads = 0;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: intent.logicalId,
        expiresAtUnix: 2_000_000_000,
      }),
      prepared: async () =>
        ({
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: preparedForFoundationIntent(),
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
  await flow.begin(intent);
  await expect(
    flow.complete(intent, async () => ({
      sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
      exportTicket: async () => ticketForFoundationIntent(),
      importTicket: async () => undefined,
      close: () => undefined,
      verifyFinalized: async () => undefined,
    })),
  ).rejects.toThrow(/selected account changed/);
  expect(recoveryReads).toBe(0);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("selection change during successful finalization prevents private verification", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  let stale = false;
  let verified = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: intent.logicalId,
        expiresAtUnix: 2_000_000_000,
      }),
      prepared: async () =>
        ({
          status: "prepared",
          logicalId: intent.logicalId,
          session: "6".repeat(48),
          preparedPayment: preparedForFoundationIntent(),
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
  await flow.begin(intent);
  await expect(
    flow.complete(intent, async () => ({
      sign: async () => [{ actionIndex: 0, signatureHex: "7".repeat(128) }],
      exportTicket: async () => ticketForFoundationIntent(),
      importTicket: async () => undefined,
      close: () => undefined,
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
  await saveFoundationTicket(journal);
  const signed = await signedFixture();
  await journal.saveFinalized(intent, signed);
  let stale = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
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

test("signed recovery ticket is stored before finalization and survives restart", async () => {
  const persisted = store();
  const journal = new ZKasBatchJournal(persisted, async () => false);
  const preparedPayment = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-v3-prepared.json", import.meta.url),
      "utf8",
    ),
  );
  const ticketIntent = {
    ...intent,
    account: preparedPayment.account,
    outputs: preparedPayment.outputs.map(
      (output: { recipient: string; amount: string; memo: string }) => ({
        recipient: output.recipient,
        amountSompi: output.amount,
        memoHex: output.memo,
      }),
    ),
    maxFeeSompi: "3000000",
  };
  await journal.reserve(ticketIntent);
  const signatures = [{ actionIndex: 0, signatureHex: "7".repeat(128) }];
  const signedTicket = JSON.stringify({
    format: "zkas-private-signed-payment",
    version: 1,
    approvalDigest: "8".repeat(64),
    prepared: preparedPayment,
    signatures,
  });
  await journal.saveSignedTicket(ticketIntent, {
    signedTicket,
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: preparedPayment.checksum,
    signatures,
  });
  const restarted = new ZKasBatchJournal(persisted, async () => false);
  const record = await restarted.get(ticketIntent.logicalId);
  expect(record?.signedTicket?.value).toBe(signedTicket);
  expect(record?.status).toBe("preparing");
  await expect(
    restarted.reserve({ ...ticketIntent, logicalId: "9".repeat(64) }),
  ).rejects.toThrow(/unresolved/i);
});

test("restart imports original signatures and verifies daemon bytes without signing again", async () => {
  const persisted = store();
  const original = new ZKasBatchJournal(persisted, async () => false);
  const preparedPayment = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-v3-prepared.json", import.meta.url),
      "utf8",
    ),
  );
  const approved = {
    ...intent,
    account: preparedPayment.account,
    outputs: preparedPayment.outputs.map(
      (output: { recipient: string; amount: string; memo: string }) => ({
        recipient: output.recipient,
        amountSompi: output.amount,
        memoHex: output.memo,
      }),
    ),
    maxFeeSompi: "3000000",
  };
  const signatures = [{ actionIndex: 0, signatureHex: "7".repeat(128) }];
  const ticket = JSON.stringify({
    format: "zkas-private-signed-payment",
    version: 1,
    approvalDigest: "8".repeat(64),
    prepared: preparedPayment,
    signatures,
  });
  await original.reserve(approved);
  await original.saveSignedTicket(approved, {
    signedTicket: ticket,
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: preparedPayment.checksum,
    signatures,
  });
  const signed = await signedFixture();
  const events: string[] = [];
  const restarted = new ZKasBatchJournal(persisted, async () => false);
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
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
        events.push("refetch");
        return signed;
      },
      submit: async () => {
        events.push("submit");
        expect((await restarted.get(approved.logicalId))?.status).toBe(
          "unknown",
        );
        return {
          status: "unknown",
          logicalId: approved.logicalId,
          txid: signed.txid,
          sha256: signed.sha256,
        };
      },
    },
    restarted,
    async () => {
      events.push("selection");
    },
  );
  await flow.recover(approved, async () => ({
    sign: async () => {
      throw new Error("must not sign");
    },
    exportTicket: async () => {
      throw new Error("must not export");
    },
    importTicket: async (value) => {
      expect(value).toBe(ticket);
      events.push("import");
    },
    verifyFinalized: async (value) => {
      expect(value).toEqual(signed);
      events.push("verify");
    },
    close: () => {
      events.push("close");
    },
  }));
  expect(events.indexOf("import")).toBeLessThan(events.indexOf("refetch"));
  expect(events.indexOf("verify")).toBeLessThan(events.indexOf("submit"));
  expect(events.indexOf("close")).toBeLessThan(events.indexOf("submit"));
  expect((await restarted.get(approved.logicalId))?.transactionHex).toBe(
    signed.transactionHex,
  );
});

test("restart after ticket persistence retries only its original daemon session and signatures", async () => {
  const { approved, preparedPayment, signatures, signedTicket } =
    recoveryFixture();
  const persisted = store();
  const original = new ZKasBatchJournal(persisted, async () => false);
  await original.reserve(approved);
  await original.saveSignedTicket(approved, {
    signedTicket,
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: preparedPayment.checksum,
    signatures,
  });
  const signed = await signedFixture();
  const events: string[] = [];
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        throw new Error("must not prepare");
      },
      finalizedJournal: async () => {
        events.push("refetch");
        throw new Error("not finalized");
      },
      finalize: async (seenIntent, session, map) => {
        events.push("finalize");
        expect(seenIntent).toEqual(approved);
        expect(session).toBe("6".repeat(48));
        expect(map).toEqual(signatures);
        return signed;
      },
      submit: async () => ({
        status: "unknown",
        logicalId: approved.logicalId,
        txid: signed.txid,
        sha256: signed.sha256,
      }),
    },
    new ZKasBatchJournal(persisted, async () => false),
    async () => undefined,
  );
  await flow.recover(approved, async (originalApproval) => {
    expect(originalApproval).toEqual(approved);
    return {
      sign: async () => {
        throw new Error("must not re-sign");
      },
      exportTicket: async () => {
        throw new Error("must not re-export");
      },
      importTicket: async (value) => {
        expect(value).toBe(signedTicket);
        events.push("import");
      },
      verifyFinalized: async (value) => {
        expect(value).toEqual(signed);
        events.push("verify");
      },
      close: () => {
        events.push("close");
      },
    };
  });
  expect(events).toEqual(["import", "refetch", "finalize", "verify", "close"]);
});

test("completion persists the original ticket before daemon finalization", async () => {
  const { approved, preparedPayment, signatures, signedTicket } =
    recoveryFixture();
  const journal = new ZKasBatchJournal(store(), async () => false);
  const signed = await signedFixture();
  const events: string[] = [];
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: approved.logicalId,
        expiresAtUnix: 2_000_000_000,
      }),
      prepared: async () => ({
        status: "prepared",
        logicalId: approved.logicalId,
        session: "6".repeat(48),
        preparedPayment,
      }),
      finalize: async () => {
        events.push("finalize");
        expect(
          (await journal.get(approved.logicalId))?.signedTicket?.value,
        ).toBe(signedTicket);
        return signed;
      },
      finalizedJournal: async () => signed,
      submit: async () => ({
        status: "unknown",
        logicalId: approved.logicalId,
        txid: signed.txid,
        sha256: signed.sha256,
      }),
    },
    journal,
    async () => undefined,
  );
  await flow.begin(approved);
  await flow.complete(approved, async () => ({
    sign: async () => signatures,
    exportTicket: async () => {
      events.push("export");
      return signedTicket;
    },
    importTicket: async () => {
      throw new Error("must not import");
    },
    verifyFinalized: async () => undefined,
    close: () => {
      events.push("close");
    },
  }));
  expect(events).toEqual(["export", "finalize", "close"]);
});

test("failed encrypted ticket write cannot reach daemon finalization", async () => {
  const { approved, preparedPayment, signatures, signedTicket } =
    recoveryFixture();
  const backing = store();
  let failWrite = false;
  const guarded = {
    getValue: backing.getValue,
    updateValue: async <T>(
      key: string,
      update: (current: T | null) => T | Promise<T>,
    ) => {
      if (failWrite) throw new Error("encrypted ticket write failed");
      await backing.updateValue(key, update);
    },
  };
  const journal = new ZKasBatchJournal(guarded, async () => false);
  let finalized = false;
  let closed = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => ({
        capability: "5".repeat(64),
        logicalId: approved.logicalId,
        expiresAtUnix: 2_000_000_000,
      }),
      prepared: async () => ({
        status: "prepared",
        logicalId: approved.logicalId,
        session: "6".repeat(48),
        preparedPayment,
      }),
      finalize: async () => {
        finalized = true;
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not refetch");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    journal,
    async () => undefined,
  );
  await flow.begin(approved);
  failWrite = true;
  await expect(
    flow.complete(approved, async () => ({
      sign: async () => signatures,
      exportTicket: async () => signedTicket,
      importTicket: async () => {
        throw new Error("must not import");
      },
      verifyFinalized: async () => {
        throw new Error("must not verify");
      },
      close: () => {
        closed = true;
      },
    })),
  ).rejects.toThrow(/ticket write/i);
  expect(finalized).toBe(false);
  expect(closed).toBe(true);
  expect((await journal.get(approved.logicalId))?.signedTicket).toBeUndefined();
});

test("a restarted preparing record without a signed ticket cannot authorize a new signature", async () => {
  const persisted = store();
  await new ZKasBatchJournal(persisted, async () => false).reserve(intent);
  const restarted = new ZKasBatchJournal(persisted, async () => false);
  let preparedReads = 0;
  let opened = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        preparedReads++;
        throw new Error("must not read prepared");
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not refetch");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    restarted,
    async () => undefined,
  );
  await expect(
    flow.complete(intent, async () => {
      opened = true;
      throw new Error("must not open signer");
    }),
  ).rejects.toThrow(/original|ticket|restart/i);
  expect(preparedReads).toBe(0);
  expect(opened).toBe(false);
  expect((await restarted.get(intent.logicalId))?.status).toBe("preparing");
});

test("ticket persistence rejects malformed signature maps even when caller supplies the same map", async () => {
  const { approved, preparedPayment, signedTicket } = recoveryFixture();
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(approved);
  for (const signatures of [
    [{ actionIndex: 1, signatureHex: "7".repeat(128) }],
    [{ actionIndex: 0, signatureHex: "7".repeat(126) }],
    [
      { actionIndex: 0, signatureHex: "7".repeat(128) },
      { actionIndex: 0, signatureHex: "8".repeat(128) },
    ],
  ]) {
    const altered = JSON.stringify({ ...JSON.parse(signedTicket), signatures });
    await expect(
      journal.saveSignedTicket(approved, {
        signedTicket: altered,
        session: "6".repeat(48),
        daemonIdentity: "https://wallet.example.test",
        preparedChecksum: preparedPayment.checksum,
        signatures,
      }),
    ).rejects.toThrow(/signature|ticket/i);
  }
  expect((await journal.get(approved.logicalId))?.signedTicket).toBeUndefined();
});

test("private ticket persistence rejects noncanonical JSON and changed approval details", async () => {
  const { approved, preparedPayment, signatures, signedTicket } =
    recoveryFixture();
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(approved);
  const save = (
    value: string,
    daemonIdentity = "https://wallet.example.test",
  ) =>
    journal.saveSignedTicket(approved, {
      signedTicket: value,
      session: "6".repeat(48),
      daemonIdentity,
      preparedChecksum: preparedPayment.checksum,
      signatures,
    });
  const raw = JSON.parse(signedTicket);
  for (const value of [
    signedTicket.replace('"version":1,', '"version":1,"version":1,'),
    JSON.stringify({ ...raw, unknown: true }),
    JSON.stringify({
      ...raw,
      prepared: { ...raw.prepared, account: intent.account },
    }),
    JSON.stringify({ ...raw, prepared: { ...raw.prepared, fee: "3000001" } }),
  ]) {
    await expect(save(value)).rejects.toThrow(/ticket|payment/i);
  }
  for (const daemonIdentity of [
    "http://wallet.example.test:8080",
    "https://wallet.example.test:99999",
    "https://wallet.example.test/path",
    "https://wallet.example.test:08080",
  ]) {
    await expect(save(signedTicket, daemonIdentity)).rejects.toThrow(
      /metadata/i,
    );
  }
  expect((await journal.get(approved.logicalId))?.signedTicket).toBeUndefined();
});

test("recovery cannot switch the retained account, origin, or configured daemon", async () => {
  const { approved, preparedPayment, signatures, signedTicket } =
    recoveryFixture();
  const persisted = store();
  const journal = new ZKasBatchJournal(persisted, async () => false);
  await journal.reserve(approved);
  await journal.saveSignedTicket(approved, {
    signedTicket,
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: preparedPayment.checksum,
    signatures,
  });
  let opened = 0;
  let daemonCalls = 0;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://other.example.test",
      grant: async () => {
        daemonCalls++;
        throw new Error("must not grant");
      },
      prepared: async () => {
        daemonCalls++;
        throw new Error("must not prepare");
      },
      finalize: async () => {
        daemonCalls++;
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        daemonCalls++;
        throw new Error("must not refetch");
      },
      submit: async () => {
        daemonCalls++;
        throw new Error("must not submit");
      },
    },
    journal,
    async () => undefined,
  );
  for (const different of [
    approved,
    { ...approved, account: intent.account },
    { ...approved, origin: "https://other.example.test" },
  ]) {
    await expect(
      flow.recover(different, async () => {
        opened++;
        throw new Error("must not open");
      }),
    ).rejects.toThrow(/ticket/i);
  }
  expect(opened).toBe(0);
  expect(daemonCalls).toBe(0);
  expect((await journal.get(approved.logicalId))?.status).toBe("preparing");
});

test("stored finalized bytes cannot be submitted through a different daemon", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  await saveFoundationTicket(journal);
  await journal.saveFinalized(intent, await signedFixture());
  let submitted = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://other.example.test",
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
        throw new Error("must not refetch");
      },
      submit: async () => {
        submitted = true;
        throw new Error("must not submit");
      },
    },
    journal,
    async () => undefined,
  );
  await expect(flow.retryStored(intent)).rejects.toThrow(/daemon|ticket/i);
  expect(submitted).toBe(false);
  expect((await journal.get(intent.logicalId))?.status).toBe("finalized");
});

test("failed recovered full-byte verification retains the ticket and account barrier", async () => {
  const { approved, preparedPayment, signatures, signedTicket } =
    recoveryFixture();
  const persisted = store();
  const journal = new ZKasBatchJournal(persisted, async () => false);
  await journal.reserve(approved);
  await journal.saveSignedTicket(approved, {
    signedTicket,
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: preparedPayment.checksum,
    signatures,
  });
  let submitted = false;
  let closed = false;
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => {
        throw new Error("must not grant");
      },
      prepared: async () => {
        throw new Error("must not prepare");
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: signedFixture,
      submit: async () => {
        submitted = true;
        throw new Error("must not submit");
      },
    },
    journal,
    async () => undefined,
  );
  await expect(
    flow.recover(approved, async () => ({
      sign: async () => {
        throw new Error("must not sign");
      },
      exportTicket: async () => {
        throw new Error("must not export");
      },
      importTicket: async () => undefined,
      verifyFinalized: async () => {
        throw new Error("invalid proof or signed bytes");
      },
      close: () => {
        closed = true;
      },
    })),
  ).rejects.toThrow(/invalid proof/i);
  expect(closed).toBe(true);
  expect(submitted).toBe(false);
  expect((await journal.get(approved.logicalId))?.status).toBe("preparing");
  await expect(
    journal.reserve({ ...approved, logicalId: "a".repeat(64) }),
  ).rejects.toThrow(/unresolved/i);
});

test("journal cannot accept finalized bytes without a retained original signed ticket", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  await journal.reserve(intent);
  await expect(
    journal.saveFinalized(intent, await signedFixture()),
  ).rejects.toThrow(/ticket/i);
  expect((await journal.get(intent.logicalId))?.status).toBe("preparing");
});

test("fresh settled history admits one new batch only after original private verification", async () => {
  const h = await freshAdmissionHarness();
  expect((await h.flow.beginAfterFreshSettlement(h.next)).logicalId).toBe(
    h.next.logicalId,
  );
  expect(h.events.indexOf("walk")).toBeLessThan(h.events.indexOf("import"));
  expect(h.events.indexOf("verify")).toBeLessThan(h.events.indexOf("status"));
  expect(h.events.filter((event) => event === "walk")).toHaveLength(2);
  expect(h.events.indexOf("status")).toBeLessThan(h.events.indexOf("grant"));
  expect((await h.journal.get(intent.logicalId))?.status).toBe("settled");
  expect((await h.journal.get(h.next.logicalId))?.status).toBe("preparing");
});

test("a settled original permits the next native direct approval without resetting account history", async () => {
  const h = await freshAdmissionHarness();
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-direct-action-flow.json", import.meta.url),
      "utf8",
    ),
  );
  const memo = "4d4a333a" + "00".repeat(508);
  const next = {
    ...h.next,
    outputs: [
      {
        recipient:
          "zkas:p8vmwuwk2npzsjc4udm4zurtdpd76rwyqwma3j9fdda3lc4yhsp30tcesf54ehq29t66jysxg9mc25s",
        amountSompi: "1",
        memoHex: memo,
      },
      { recipient: "zkas:" + "c".repeat(80), amountSompi: "1", memoHex: memo },
      { recipient: "zkas:" + "d".repeat(80), amountSompi: "1", memoHex: memo },
      {
        recipient:
          "zkas:pxm8d4su40hc95vr0llq7rrf5gqzhmdhh5m3c8qtve2dllfxrqrsh6wlugnyp3krnxe2cgs4fmfwagv",
        amountSompi: "10000000",
        memoHex: "00".repeat(512),
      },
    ],
    maxFeeSompi: "5000000",
  };
  const approval = {
    version: 1 as const,
    actionId: "55".repeat(16),
    idempotencyKey: next.logicalId,
    exactDigest: "66".repeat(32),
    commitment: "bb".repeat(32),
    fanoutDigest: "cc".repeat(32),
    birthHash: "77".repeat(32),
    sessionId: "88".repeat(16),
    sourceGeneration: "7",
    ownerPeerId: "99".repeat(16),
    recipientPeerId: "aa".repeat(16),
    recipientCardHex: fixture.bobCardHex,
    kind: "invite" as const,
    referenceActionId: null,
    text: "hello",
  };
  expect(
    (await h.flow.beginDirectAfterFreshSettlement(next, approval)).logicalId,
  ).toBe(next.logicalId);
  expect((await h.journal.get(next.logicalId))?.directApproval).toEqual(
    approval,
  );
  expect((await h.journal.get(intent.logicalId))?.status).toBe("settled");
  expect(h.events.indexOf("verify")).toBeLessThan(h.events.indexOf("grant"));
});

test("freshly proven original settlement becomes local before the next native review", async () => {
  const h = await freshAdmissionHarness();
  await expect(
    h.journal.assertNoUnresolvedAccountAction(intent.selection),
  ).rejects.toThrow(/already pending/i);
  await h.flow.reconcileAccountAfterFreshSettlement(intent);
  expect((await h.journal.get(intent.logicalId))?.status).toBe("settled");
  expect(h.events.filter((event) => event === "walk")).toHaveLength(2);
  expect(h.events.indexOf("verify")).toBeLessThan(h.events.indexOf("status"));
  expect(h.events).not.toContain("grant");
  await expect(
    h.journal.assertNoUnresolvedAccountAction(intent.selection),
  ).resolves.toBeUndefined();
});

test("pre-review settlement refuses unsettled status, changed inventory, and failed byte verification", async () => {
  const nonsettled = await freshAdmissionHarness();
  const originalStatus = nonsettled.controls.status;
  nonsettled.controls.status = () => ({
    ...(originalStatus() as ZKasBatchSendStatus),
    status: "included",
  });
  await expect(
    nonsettled.flow.reconcileAccountAfterFreshSettlement(intent),
  ).rejects.toThrow(/settled/i);
  expect((await nonsettled.journal.get(intent.logicalId))?.status).toBe(
    "unknown",
  );

  const changed = await freshAdmissionHarness();
  const originalInventory = changed.controls.inventory;
  let walks = 0;
  changed.controls.inventory = async () => {
    const inventory = await originalInventory();
    return ++walks === 2
      ? {
          ...inventory,
          entries: [{ ...inventory.entries[0], sha256: "d".repeat(64) }],
        }
      : inventory;
  };
  await expect(
    changed.flow.reconcileAccountAfterFreshSettlement(intent),
  ).rejects.toThrow(/inventory|identity/i);
  expect((await changed.journal.get(intent.logicalId))?.status).toBe("unknown");

  const unverified = await freshAdmissionHarness();
  unverified.controls.open = async () => ({
    sign: async () => {
      throw new Error("must not sign");
    },
    exportTicket: async () => {
      throw new Error("must not export");
    },
    importTicket: async () => undefined,
    verifyFinalized: async () => {
      throw new Error("Original bytes failed verification");
    },
    close: () => undefined,
  });
  await expect(
    unverified.flow.reconcileAccountAfterFreshSettlement(intent),
  ).rejects.toThrow(/verification/i);
  expect((await unverified.journal.get(intent.logicalId))?.status).toBe(
    "unknown",
  );
});

async function freshAdmissionHarness() {
  const backing = store();
  let legacy = false;
  const journal = new ZKasBatchJournal(backing, async () => legacy);
  await journal.reserve(intent);
  await saveFoundationTicket(journal);
  const signed = await signedFixture();
  await journal.saveFinalized(intent, signed);
  await journal.markUnknown(intent.logicalId);
  const next = { ...intent, logicalId: "4".repeat(64) };
  const events: string[] = [];
  let walk = 0;
  const inventory = (): ZKasBatchInventory => ({
    inventoryOnly: true,
    epoch: (++walk).toString(16).padStart(64, "0"),
    unlistedReservationCount: 0,
    entries: [
      {
        logicalId: intent.logicalId,
        revision: walk,
        status: "unknown",
        txid: signed.txid,
        sha256: signed.sha256,
      },
    ],
  });
  const controls: {
    inventory: () => ZKasBatchInventory | Promise<ZKasBatchInventory>;
    status: () => ZKasBatchSendStatus | Promise<ZKasBatchSendStatus>;
    open: (approved: ZKasBatchIntent) => Promise<PrivateBatchSigner>;
    fence: () => void;
    grant: () => Promise<{
      capability: string;
      logicalId: string;
      expiresAtUnix: number;
    }>;
    clock: () => number;
  } = {
    inventory,
    status: () => ({
      status: "settled",
      logicalId: intent.logicalId,
      txid: signed.txid,
      sha256: signed.sha256,
    }),
    open: async () => ({
      sign: async () => {
        throw new Error("must not sign");
      },
      exportTicket: async () => {
        throw new Error("must not export");
      },
      importTicket: async (ticket) => {
        expect(ticket).toBe(ticketForFoundationIntent());
        events.push("import");
      },
      verifyFinalized: async (bytes) => {
        expect(bytes).toEqual(signed);
        events.push("verify");
      },
      close: () => {
        events.push("close");
      },
    }),
    fence: () => undefined,
    clock: () => 0,
    grant: async () => ({
      capability: "5".repeat(64),
      logicalId: next.logicalId,
      expiresAtUnix: 2_000_000_000,
    }),
  };
  const flow = new ZKasBatchPayment(
    {
      identity: "https://wallet.example.test",
      grant: async () => {
        events.push("grant");
        return controls.grant();
      },
      prepared: async () => {
        throw new Error("must not prepare");
      },
      finalize: async () => {
        throw new Error("must not finalize");
      },
      finalizedJournal: async () => {
        throw new Error("must not refetch");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
    },
    journal,
    async () => undefined,
    {
      assertCurrent: () => controls.fence(),
      client: {
        discoverRecords: async () => {
          events.push("walk");
          return controls.inventory();
        },
        status: async () => {
          events.push("status");
          return controls.status();
        },
      },
      openRecoverySigner: async (approved) => {
        events.push("open");
        return controls.open(approved);
      },
      monotonicNow: () => controls.clock(),
    },
  );
  return {
    backing,
    journal,
    flow,
    next,
    signed,
    events,
    controls,
    setLegacy: (value: boolean) => {
      legacy = value;
    },
  };
}

test("malformed first inventory fails before opening original signer", async () => {
  const h = await freshAdmissionHarness();
  const original = h.controls.inventory;
  h.controls.inventory = () => ({ ...original(), epoch: "invalid" });
  await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
    /inventory/i,
  );
  expect(h.events).not.toContain("open");
  expect(await h.journal.get(h.next.logicalId)).toBeUndefined();
});

test("a context failure immediately after signer opening still closes that handle", async () => {
  const h = await freshAdmissionHarness();
  let current = true;
  h.controls.fence = () => {
    if (!current) throw new Error("context changed");
  };
  const original = h.controls.open;
  h.controls.open = async (approved) => {
    const signer = await original(approved);
    current = false;
    return signer;
  };
  await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
    /context changed/i,
  );
  expect(h.events).toContain("close");
  expect(h.events).not.toContain("status");
  expect(await h.journal.get(h.next.logicalId)).toBeUndefined();
});

test("extra or unlisted daemon reservations block before private signer opening", async () => {
  for (const corrupt of [
    (walk: ZKasBatchInventory) => ({ ...walk, unlistedReservationCount: 1 }),
    (walk: ZKasBatchInventory) => ({
      ...walk,
      entries: [
        ...walk.entries,
        { ...walk.entries[0], logicalId: "e".repeat(64) },
      ],
    }),
  ]) {
    const h = await freshAdmissionHarness();
    const original = h.controls.inventory;
    h.controls.inventory = async () => corrupt(await original());
    await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
      /inventory|reservation/i,
    );
    expect(h.events).not.toContain("open");
    expect(await h.journal.get(h.next.logicalId)).toBeUndefined();
  }
});

test("nonsettled exact-ID status or changed second walk retains original UNKNOWN", async () => {
  const nonsettled = await freshAdmissionHarness();
  const status = nonsettled.controls.status;
  nonsettled.controls.status = () => ({
    ...(status() as ZKasBatchSendStatus),
    status: "included",
  });
  await expect(
    nonsettled.flow.beginAfterFreshSettlement(nonsettled.next),
  ).rejects.toThrow(/settled/i);
  expect(nonsettled.events.filter((event) => event === "walk")).toHaveLength(1);
  expect((await nonsettled.journal.get(intent.logicalId))?.status).toBe(
    "unknown",
  );
  expect(
    await nonsettled.journal.get(nonsettled.next.logicalId),
  ).toBeUndefined();

  const changed = await freshAdmissionHarness();
  const original = changed.controls.inventory;
  let count = 0;
  changed.controls.inventory = async () => {
    const walk = await original();
    return ++count === 2
      ? { ...walk, entries: [{ ...walk.entries[0], sha256: "d".repeat(64) }] }
      : walk;
  };
  await expect(
    changed.flow.beginAfterFreshSettlement(changed.next),
  ).rejects.toThrow(/inventory|identity/i);
  expect(changed.events).not.toContain("grant");
  expect((await changed.journal.get(intent.logicalId))?.status).toBe("unknown");
});

test("a late legacy reservation or local journal mutation aborts the final append", async () => {
  const legacy = await freshAdmissionHarness();
  const originalStatus = legacy.controls.status;
  legacy.controls.status = async () => {
    legacy.setLegacy(true);
    return originalStatus();
  };
  await expect(
    legacy.flow.beginAfterFreshSettlement(legacy.next),
  ).rejects.toThrow(/legacy/i);
  expect(legacy.events).not.toContain("grant");
  expect(await legacy.journal.get(legacy.next.logicalId)).toBeUndefined();

  const changed = await freshAdmissionHarness();
  const update = changed.backing.updateValue;
  let injected = false;
  changed.backing.updateValue = async <T>(
    key: string,
    callback: (current: T | null) => T | Promise<T>,
  ) => {
    if (!injected) {
      injected = true;
      await update<Record<string, ZKasBatchRecord>>(
        BATCH_JOURNAL_KEY,
        (current) => ({
          ...current,
          [intent.logicalId]: {
            ...current![intent.logicalId],
            status: "included",
          },
        }),
      );
    }
    await update(key, callback);
  };
  await expect(
    changed.flow.beginAfterFreshSettlement(changed.next),
  ).rejects.toThrow(/changed/i);
  expect(changed.events).not.toContain("grant");
  expect(await changed.journal.get(changed.next.logicalId)).toBeUndefined();
});

test("admission deadline and first-use require evidence before any new grant", async () => {
  const expired = await freshAdmissionHarness();
  const original = expired.controls.inventory;
  let elapsed = 0;
  expired.controls.clock = () => elapsed;
  expired.controls.inventory = async () => {
    const walk = await original();
    elapsed = 120_001;
    return walk;
  };
  await expect(
    expired.flow.beginAfterFreshSettlement(expired.next),
  ).rejects.toThrow(/deadline/i);
  expect(expired.events).not.toContain("open");
  expect(expired.events).not.toContain("grant");

  const empty = new ZKasBatchJournal(store(), async () => false);
  let proved = false;
  await expect(
    empty.reserveAfterFreshSettlement(
      intent,
      () => undefined,
      async () => {
        proved = true;
      },
    ),
  ).rejects.toThrow(/enrollment/i);
  expect(proved).toBe(false);
});

test("failed grant retains the new preparing reservation and old signed ticket", async () => {
  const h = await freshAdmissionHarness();
  h.controls.grant = async () => {
    throw new Error("grant offline");
  };
  await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
    /grant offline/i,
  );
  expect((await h.journal.get(h.next.logicalId))?.status).toBe("preparing");
  expect((await h.journal.get(intent.logicalId))?.signedTicket?.value).toBe(
    ticketForFoundationIntent(),
  );
  await expect(
    h.journal.reserve({ ...h.next, logicalId: "5".repeat(64) }),
  ).rejects.toThrow(/unresolved/i);
  h.controls.grant = async () => ({
    capability: "5".repeat(64),
    logicalId: h.next.logicalId,
    expiresAtUnix: 2_000_000_000,
  });
  await expect(h.flow.begin(h.next)).rejects.toThrow(/fresh|private/i);
  expect((await h.flow.beginAfterFreshSettlement(h.next)).logicalId).toBe(
    h.next.logicalId,
  );
});

test("an asynchronous context callback cannot masquerade as the synchronous admission fence", async () => {
  const h = await freshAdmissionHarness();
  h.controls.fence = async () => undefined;
  await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
    /synchronous|fence/i,
  );
  expect(h.events).not.toContain("walk");
  expect(h.events).not.toContain("grant");
  expect(await h.journal.get(h.next.logicalId)).toBeUndefined();
});

test("failed original private verification closes its handle without polling or appending", async () => {
  const h = await freshAdmissionHarness();
  const original = h.controls.open;
  h.controls.open = async (approved) => {
    const signer = await original(approved);
    return {
      ...signer,
      verifyFinalized: async () => {
        throw new Error("invalid original signed proof");
      },
    };
  };
  await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
    /invalid original signed proof/i,
  );
  expect(h.events).toContain("import");
  expect(h.events).toContain("close");
  expect(h.events).not.toContain("status");
  expect(h.events).not.toContain("grant");
  expect((await h.journal.get(intent.logicalId))?.status).toBe("unknown");
  expect(await h.journal.get(h.next.logicalId)).toBeUndefined();
});

test("128 retained private records require separate archival before admission", async () => {
  const h = await freshAdmissionHarness();
  const original = (await h.journal.get(intent.logicalId))!;
  await h.backing.updateValue<Record<string, ZKasBatchRecord>>(
    BATCH_JOURNAL_KEY,
    (current) => {
      const records = { ...current };
      for (let index = 1; index < 128; index++) {
        const logicalId = index.toString(16).padStart(64, "0");
        records[logicalId] = {
          ...structuredClone(original),
          intent: { ...structuredClone(original.intent), logicalId },
        };
      }
      return records;
    },
  );
  await expect(h.flow.beginAfterFreshSettlement(h.next)).rejects.toThrow(
    /full/i,
  );
  expect(h.events).not.toContain("walk");
  expect(h.events).not.toContain("grant");
  expect(await h.journal.get(h.next.logicalId)).toBeUndefined();
});

test("two different new intents serialize through the shared account gate", async () => {
  const h = await freshAdmissionHarness();
  const other = { ...h.next, logicalId: "5".repeat(64) };
  const results = await Promise.allSettled([
    h.flow.beginAfterFreshSettlement(h.next),
    h.flow.beginAfterFreshSettlement(other),
  ]);
  expect(results.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(h.events.filter((event) => event === "grant")).toHaveLength(1);
  expect((await h.journal.get(h.next.logicalId))?.status).toBe("preparing");
  expect(await h.journal.get(other.logicalId)).toBeUndefined();
});

test("cached local settled status still requires private re-verification and fresh status", async () => {
  const h = await freshAdmissionHarness();
  await h.backing.updateValue<Record<string, ZKasBatchRecord>>(
    BATCH_JOURNAL_KEY,
    (current) => ({
      ...current,
      [intent.logicalId]: { ...current![intent.logicalId], status: "settled" },
    }),
  );
  await h.flow.beginAfterFreshSettlement(h.next);
  expect(h.events).toContain("import");
  expect(h.events).toContain("verify");
  expect(h.events).toContain("status");
  expect(h.events.indexOf("verify")).toBeLessThan(h.events.indexOf("grant"));
});

test("caller mutation during remote inventory cannot change the approved new intent", async () => {
  const h = await freshAdmissionHarness();
  const approved = structuredClone(h.next);
  const original = h.controls.inventory;
  h.controls.inventory = async () => {
    h.next.maxFeeSompi = "2000000";
    return original();
  };
  await h.flow.beginAfterFreshSettlement(h.next);
  expect((await h.journal.get(approved.logicalId))?.intent).toEqual(approved);
});
