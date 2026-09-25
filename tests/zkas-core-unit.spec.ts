import { expect, test } from "@playwright/test";
import { formatZkasAmount, parseZkasAmount } from "@/lib/zkas/amount";
import { historyDetailLabels } from "@/lib/zkas/history-detail";
import { validateZKasMemo } from "@/lib/zkas/memo";
import {
  probeZKasDaemonBirthday,
  ZKasClient,
  ZKasSubmissionUncertainError,
  type ZKasSigner,
} from "@/lib/zkas/client";

test("ZKAS amounts use exact 8-decimal integer sompi", () => {
  expect(String(parseZkasAmount("1.00000001"))).toBe("100000001");
  expect(formatZkasAmount(100000001n)).toBe("1.00000001");
  for (const invalid of ["", "0", "-1", "1e2", "1.000000001", "1,000"]) {
    expect(() => parseZkasAmount(invalid)).toThrow();
  }
});

const txid = "a".repeat(64);
const goodStatus = {
  has_wallet: true,
  address: "zkas:test-address",
  network: "mainnet",
  node_connected: true,
  daa_score: 123456,
  synced: true,
  missing_history: false,
  balance_sompi: "1000",
};

test("daemon probing uses a fresh token before a wallet exists", async () => {
  const tokens: string[] = [];
  const daemonFetch = (async (_url: string, init?: RequestInit) => {
    const token = new Headers(init?.headers).get("X-Wallet-Token");
    if (!token || !/^[0-9a-f]{32}$/.test(token)) {
      return new Response(null, { status: 401 });
    }
    tokens.push(token);
    return Response.json({ ...goodStatus, has_wallet: false, address: null });
  }) as typeof fetch;

  await expect(
    probeZKasDaemonBirthday("https://wallet.example", "mainnet", daemonFetch),
  ).resolves.toBe(123456);
  await expect(
    probeZKasDaemonBirthday("https://wallet.example", "mainnet", daemonFetch),
  ).resolves.toBe(123456);
  expect(tokens).toHaveLength(2);
  expect(tokens[0]).not.toBe(tokens[1]);
});
const goodPrepare = {
  session: "session-1",
  bundle_hex: "ab",
  amount_sompi_exact: "100",
  fee_sompi_exact: "10",
  remaining_sompi_exact: "0",
  disclosure: [],
  spend_auth: [],
};

function fakeDaemon(responses: Record<string, unknown>) {
  const calls: { path: string; body: unknown }[] = [];
  const daemonFetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/daemon/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (responses[path] instanceof Error) throw responses[path];
    return new Response(JSON.stringify(responses[path]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { daemonFetch, calls };
}

function fakeSigner() {
  const verified: unknown[] = [];
  const signer: ZKasSigner = {
    address: () => goodStatus.address,
    fullViewingKeyHex: async () => "f".repeat(192),
    verifyAndSign: async (input) => {
      verified.push(input);
      return [{ index: 0, sig: "a".repeat(128) }];
    },
  };
  return { signer, verified };
}

test("watch-only state recovers from genesis and returns exact balance", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": { ...goodStatus, has_wallet: false },
    "/api/wallet/watch": { address: goodStatus.address },
    "/api/wallet/balance": { balance_sompi: "1000" },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example/daemon",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  const state = await client.state("f".repeat(192), goodStatus.address);
  expect(String(state.balanceSompi)).toBe("1000");
  expect(calls.find((call) => call.path.endsWith("/watch"))?.body).toEqual({
    fvk_hex: "f".repeat(192),
    birthday: 0,
    recoverable_history: true,
  });
  expect(JSON.stringify(calls)).not.toContain("seed");
});

test("new-wallet registration uses the supplied birthday once", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": { ...goodStatus, has_wallet: false, address: null },
    "/api/wallet/watch": { address: goodStatus.address },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  await client.register("f".repeat(192), goodStatus.address, 123456);
  expect(calls.find((call) => call.path.endsWith("/watch"))?.body).toEqual({
    fvk_hex: "f".repeat(192),
    birthday: 123456,
    recoverable_history: true,
  });
});

test("a birthday ahead of the current daemon height recovers from genesis", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": {
      ...goodStatus,
      has_wallet: false,
      address: null,
      daa_score: 100,
    },
    "/api/wallet/watch": { address: goodStatus.address },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  await client.register("f".repeat(192), goodStatus.address, 999);
  expect(calls.find((call) => call.path.endsWith("/watch"))?.body).toEqual({
    fvk_hex: "f".repeat(192),
    birthday: 0,
    recoverable_history: true,
  });
});

test("history reads bounded rows and rejects imprecise amounts", async () => {
  const { daemonFetch } = fakeDaemon({
    "/api/wallet/history": {
      recoverableHistory: true,
      total: 1,
      rows: [
        { kind: "sent", txid, amountSompi: 100, feeSompi: 10, timestamp: 0 },
      ],
      pendingOutgoing: [],
    },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  expect((await client.history()).rows[0].amountSompi).toBe(100);
  expect((await client.history()).rows[0].amountSompiExact).toBe("100");
  const unsafe = fakeDaemon({
    "/api/wallet/history": {
      recoverableHistory: true,
      total: 1,
      rows: [
        {
          kind: "sent",
          txid,
          amountSompi: Number.MAX_SAFE_INTEGER + 1,
          feeSompi: 10,
          timestamp: 0,
        },
      ],
    },
  });
  const unsafeClient = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: unsafe.daemonFetch,
  });
  await expect(unsafeClient.history()).rejects.toThrow();
});

test("history details preserve exact amounts and daemon-provided memo text", async () => {
  const { daemonFetch } = fakeDaemon({
    "/api/wallet/history": {
      recoverableHistory: true,
      total: 1,
      rows: [
        {
          kind: "sent",
          txid,
          amountSompi: 9007199254740992,
          amountSompiExact: "9007199254740993",
          amountKind: "netOutflow",
          feeSompi: 0,
          feeSompiExact: "0",
          feeKnown: false,
          timestamp: 0,
          daaScore: 42,
          recipient: null,
          memo: "<img src=x onerror=alert(1)>",
        },
      ],
      pendingOutgoing: [{ txid, amountSompi: 9007199254740992 }],
    },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  const history = await client.history();
  expect(history.rows[0].amountSompiExact).toBe("9007199254740993");
  expect(history.pendingOutgoing?.[0].amountSompiExact).toBeUndefined();
  expect(formatZkasAmount(BigInt(history.rows[0].amountSompiExact))).toBe(
    "90071992.54740993",
  );
  expect(history.rows[0].feeKnown).toBe(false);
  expect(history.rows[0].recipient).toBeNull();
  expect(history.rows[0].memo).toBe("<img src=x onerror=alert(1)>");
  expect(historyDetailLabels(history.rows[0]).amount).toBe("Net outflow");
});

test("history labels do not attribute multi-output totals to one recipient", async () => {
  const { daemonFetch } = fakeDaemon({
    "/api/wallet/history": {
      recoverableHistory: true,
      total: 1,
      rows: [
        {
          kind: "sent",
          txid,
          amountSompiExact: "150000000",
          feeSompiExact: "1000",
          timestamp: 1,
          amountKind: "paid",
          recipient: "zkas:first-output",
          memo: "first memo",
        },
      ],
    },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  expect(historyDetailLabels((await client.history()).rows[0])).toEqual({
    amount: "Total paid",
    recipient: "Reported recipient",
    firstRecipientOnly: true,
  });
});

test("history rejects a conflicting exact amount and an oversized memo", async () => {
  for (const row of [
    {
      kind: "received",
      txid,
      amountSompi: 100,
      amountSompiExact: "101",
      feeSompi: 0,
      timestamp: 0,
    },
    {
      kind: "received",
      txid,
      amountSompi: 100,
      feeSompi: 0,
      timestamp: 0,
      memo: "x".repeat(513),
    },
  ]) {
    const { daemonFetch } = fakeDaemon({
      "/api/wallet/history": {
        recoverableHistory: true,
        total: 1,
        rows: [row],
      },
    });
    const client = new ZKasClient({
      baseUrl: "https://wallet.example",
      token: "b".repeat(32),
      network: "mainnet",
      fetch: daemonFetch,
    });
    await expect(client.history()).rejects.toThrow();
  }
});

test("read-only state exposes incomplete sync without presenting it as final", async () => {
  const { daemonFetch } = fakeDaemon({
    "/api/status": {
      ...goodStatus,
      synced: false,
      missing_history: true,
    },
    "/api/wallet/balance": { balance_sompi: "1000" },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  const state = await client.state("f".repeat(192), goodStatus.address);
  expect(state.synced).toBe(false);
  expect(state.missingHistory).toBe(true);
  expect(String(state.balanceSompi)).toBe("1000");
});

test("send verifies the prepared payment before submitting", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": goodStatus,
    "/api/wallet/balance": { balance_sompi: "1000" },
    "/api/wallet/prepare": goodPrepare,
    "/api/wallet/submit": {
      txid,
      amount_sompi_exact: "100",
      fee_sompi_exact: "10",
    },
  });
  const { signer, verified } = fakeSigner();
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  const result = await client.send({
    signer,
    to: "zkas:recipient",
    amountSompi: 100n,
    maxFeeSompi: 20n,
  });
  expect(result.txid).toBe(txid);
  expect(String(result.daemonReportedFeeSompi)).toBe("10");
  expect(verified).toHaveLength(1);
  expect(verified[0]).toMatchObject({ memo: "" });
  expect(calls.map((call) => call.path)).toEqual([
    "/api/status",
    "/api/wallet/balance",
    "/api/wallet/prepare",
    "/api/wallet/submit",
  ]);
  expect(calls.find((call) => call.path.endsWith("/prepare"))?.body).toEqual({
    fvk_hex: "f".repeat(192),
    to: "zkas:recipient",
    amount_sompi: "100",
    fee: "0",
    allow_partial: false,
  });
});

test("send passes the exact 512-byte memo to non-custodial prepare", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": goodStatus,
    "/api/wallet/balance": { balance_sompi: "1000" },
    "/api/wallet/prepare": goodPrepare,
    "/api/wallet/submit": {
      txid,
      amount_sompi_exact: "100",
      fee_sompi_exact: "10",
    },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  const memo = `  ${"é".repeat(254)}\n  `;
  expect(new TextEncoder().encode(memo).length).toBe(513);
  const maxMemo = ` ${"é".repeat(254)}\n  `;
  expect(new TextEncoder().encode(maxMemo).length).toBe(512);
  const { signer, verified } = fakeSigner();
  await client.send({
    signer,
    to: "zkas:recipient",
    amountSompi: 100n,
    maxFeeSompi: 20n,
    memo: maxMemo,
  });
  expect(
    calls.find((call) => call.path.endsWith("/prepare"))?.body,
  ).toMatchObject({
    memo: maxMemo,
    allow_partial: false,
  });
  expect(verified).toHaveLength(1);
  expect(verified[0]).toMatchObject({ memo: maxMemo });
  expect(calls.some((call) => call.path === "/api/wallet/send")).toBe(false);
});

test("oversized and malformed memos fail before the daemon is contacted", async () => {
  const { daemonFetch, calls } = fakeDaemon({});
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  for (const memo of ["x".repeat(513), "😀".repeat(129), "\ud800"]) {
    await expect(
      client.send({
        signer: fakeSigner().signer,
        to: "zkas:recipient",
        amountSompi: 100n,
        maxFeeSompi: 20n,
        memo,
      }),
    ).rejects.toThrow(/memo/i);
  }
  expect(calls).toEqual([]);
  expect(validateZKasMemo("")).toBeUndefined();
  expect(validateZKasMemo(" \n ")).toBe(" \n ");
  expect(validateZKasMemo("\uFEFFreference")).toBe("\uFEFFreference");
});

test("an excessive prepared fee shows the daemon quote without signing or submitting", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": goodStatus,
    "/api/wallet/balance": { balance_sompi: "222000000" },
    "/api/wallet/prepare": {
      ...goodPrepare,
      amount_sompi_exact: "103000000",
      fee_sompi_exact: "1855400",
    },
  });
  const { signer, verified } = fakeSigner();
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });

  await expect(
    client.send({
      signer,
      to: "zkas:recipient",
      amountSompi: 103000000n,
      maxFeeSompi: 10000n,
    }),
  ).rejects.toThrow(
    "ZKas daemon proposes a fee of 0.018554 ZKAS, above your 0.0001 ZKAS maximum. No payment was signed or submitted.",
  );
  expect(verified).toHaveLength(0);
  expect(calls.some((call) => call.path.endsWith("/submit"))).toBe(false);
});

test("submission failures carry uncertain outcome and preserve any returned txid", async () => {
  for (const response of [
    new Error("connection lost"),
    { txid, amount_sompi_exact: "99", fee_sompi_exact: "10" },
    { txid, amount_sompi_exact: "invalid", fee_sompi_exact: "10" },
    { txid, amount_sompi_exact: "100", fee_sompi_exact: "invalid" },
  ]) {
    const { daemonFetch, calls } = fakeDaemon({
      "/api/status": goodStatus,
      "/api/wallet/balance": { balance_sompi: "1000" },
      "/api/wallet/prepare": goodPrepare,
      "/api/wallet/submit": response,
    });
    const client = new ZKasClient({
      baseUrl: "https://wallet.example",
      token: "b".repeat(32),
      network: "mainnet",
      fetch: daemonFetch,
    });
    let caught: unknown;
    try {
      await client.send({
        signer: fakeSigner().signer,
        to: "zkas:recipient",
        amountSompi: 100n,
        maxFeeSompi: 20n,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZKasSubmissionUncertainError);
    expect((caught as ZKasSubmissionUncertainError).txid).toBe(
      response instanceof Error ? undefined : txid,
    );
    expect(calls.filter((call) => call.path.endsWith("/submit"))).toHaveLength(
      1,
    );
  }
});

test("hostile or incomplete daemon responses never reach signing or submit", async () => {
  const cases = [
    {
      status: { ...goodStatus, network: "testnet" },
      prepare: goodPrepare,
      error: /network/i,
    },
    {
      status: { ...goodStatus, address: "zkas:attacker" },
      prepare: goodPrepare,
      error: /address/i,
    },
    {
      status: { ...goodStatus, synced: false },
      prepare: goodPrepare,
      error: /sync/i,
    },
    {
      status: { ...goodStatus, missing_history: true },
      prepare: goodPrepare,
      error: /history/i,
    },
    {
      status: goodStatus,
      prepare: { ...goodPrepare, amount_sompi_exact: "99" },
      error: /amount/i,
    },
    {
      status: goodStatus,
      prepare: { ...goodPrepare, fee_sompi_exact: "21" },
      error: /fee/i,
    },
    {
      status: goodStatus,
      prepare: { ...goodPrepare, remaining_sompi_exact: "1" },
      error: /partial/i,
    },
  ];
  for (const item of cases) {
    const { daemonFetch, calls } = fakeDaemon({
      "/api/status": item.status,
      "/api/wallet/balance": { balance_sompi: "1000" },
      "/api/wallet/prepare": item.prepare,
    });
    const { signer, verified } = fakeSigner();
    const client = new ZKasClient({
      baseUrl: "https://wallet.example",
      token: "b".repeat(32),
      network: "mainnet",
      fetch: daemonFetch,
    });
    await expect(
      client.send({
        signer,
        to: "zkas:recipient",
        amountSompi: 100n,
        maxFeeSompi: 20n,
      }),
    ).rejects.toThrow(item.error);
    expect(verified).toHaveLength(0);
    expect(calls.some((call) => call.path.endsWith("/submit"))).toBe(false);
  }
});

test("watch response cannot replace the locally derived receive address", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": { ...goodStatus, has_wallet: false },
    "/api/wallet/watch": { address: "zkas:attacker" },
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  await expect(
    client.state("f".repeat(192), goodStatus.address),
  ).rejects.toThrow(/address/i);
  expect(calls.some((call) => call.path.endsWith("/balance"))).toBe(false);
});

test("testnet payment fails before a daemon request because signer cannot verify it", async () => {
  const { daemonFetch, calls } = fakeDaemon({});
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "testnet",
    fetch: daemonFetch,
  });
  await expect(
    client.send({
      signer: fakeSigner().signer,
      to: "zkastest:recipient",
      amountSompi: 100n,
      maxFeeSompi: 20n,
    }),
  ).rejects.toThrow(/testnet/i);
  expect(calls).toHaveLength(0);
});

test("account changes before submit prevent signature delivery to daemon", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": goodStatus,
    "/api/wallet/balance": { balance_sompi: "1000" },
    "/api/wallet/prepare": goodPrepare,
  });
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
  });
  const { signer, verified } = fakeSigner();
  await expect(
    client.send({
      signer,
      to: "zkas:recipient",
      amountSompi: 100n,
      maxFeeSompi: 20n,
      beforeSubmit: async () => {
        throw new Error("Selected account changed");
      },
    }),
  ).rejects.toThrow(/account changed/i);
  expect(verified).toHaveLength(1);
  expect(calls.some((call) => call.path.endsWith("/submit"))).toBe(false);
});

test("revoked payment guard blocks daemon submission after proof preparation", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": goodStatus,
    "/api/wallet/balance": { balance_sompi: "1000" },
    "/api/wallet/prepare": goodPrepare,
  });
  let connected = true;
  const signer = fakeSigner().signer;
  const sign = signer.verifyAndSign;
  signer.verifyAndSign = async (input) => {
    const signatures = await sign(input);
    connected = false;
    return signatures;
  };
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
    guard: async () => {
      if (!connected) throw new Error("Website was disconnected");
    },
  });
  await expect(
    client.send({
      signer,
      to: "zkas:recipient",
      amountSompi: 100n,
      maxFeeSompi: 20n,
    }),
  ).rejects.toThrow(/disconnected/i);
  expect(calls.some((call) => call.path.endsWith("/submit"))).toBe(false);
});

test("authorization change during journal persistence stops before daemon submit", async () => {
  const { daemonFetch, calls } = fakeDaemon({
    "/api/status": goodStatus,
    "/api/wallet/balance": { balance_sompi: "1000" },
    "/api/wallet/prepare": goodPrepare,
  });
  let connected = true;
  const client = new ZKasClient({
    baseUrl: "https://wallet.example",
    token: "b".repeat(32),
    network: "mainnet",
    fetch: daemonFetch,
    guard: async () => {
      if (!connected) throw new Error("Website was disconnected");
    },
  });
  await expect(
    client.send({
      signer: fakeSigner().signer,
      to: "zkas:recipient",
      amountSompi: 100n,
      maxFeeSompi: 20n,
      beforeSubmit: async () => {
        connected = false;
      },
    }),
  ).rejects.toThrow(/disconnected/i);
  expect(calls.some((call) => call.path.endsWith("/submit"))).toBe(false);
});

test("daemon configuration rejects remote plaintext and malformed tokens", () => {
  expect(
    () =>
      new ZKasClient({
        baseUrl: "http://wallet.example",
        token: "b".repeat(32),
        network: "mainnet",
      }),
  ).toThrow(/https/i);
  expect(
    () =>
      new ZKasClient({
        baseUrl: "https://wallet.example",
        token: "short",
        network: "mainnet",
      }),
  ).toThrow(/token/i);
});
