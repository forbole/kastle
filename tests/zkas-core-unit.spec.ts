import { expect, test } from "@playwright/test";
import { formatZkasAmount, parseZkasAmount } from "@/lib/zkas/amount";
import { ZKasClient, ZKasSubmissionUncertainError, type ZKasSigner } from "@/lib/zkas/client";

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
  synced: true,
  missing_history: false,
  balance_sompi: "1000",
};
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

test("watch-only state registers only the viewing key and returns exact balance", async () => {
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
  });
  expect(JSON.stringify(calls)).not.toContain("seed");
});

test("history reads bounded rows and rejects imprecise amounts", async () => {
  const { daemonFetch } = fakeDaemon({
    "/api/wallet/history": {
      recoverableHistory: true,
      total: 1,
      rows: [{ kind: "sent", txid, amountSompi: 100, feeSompi: 10, timestamp: 0 }],
      pendingOutgoing: [],
    },
  });
  const client = new ZKasClient({ baseUrl: "https://wallet.example", token: "b".repeat(32), network: "mainnet", fetch: daemonFetch });
  expect((await client.history()).rows[0].amountSompi).toBe(100);
  const unsafe = fakeDaemon({
    "/api/wallet/history": {
      recoverableHistory: true,
      total: 1,
      rows: [{ kind: "sent", txid, amountSompi: Number.MAX_SAFE_INTEGER + 1, feeSompi: 10, timestamp: 0 }],
    },
  });
  const unsafeClient = new ZKasClient({ baseUrl: "https://wallet.example", token: "b".repeat(32), network: "mainnet", fetch: unsafe.daemonFetch });
  await expect(unsafeClient.history()).rejects.toThrow();
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
  expect(calls.map((call) => call.path)).toEqual([
    "/api/status",
    "/api/wallet/balance",
    "/api/wallet/prepare",
    "/api/wallet/submit",
  ]);
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
      await client.send({ signer: fakeSigner().signer, to: "zkas:recipient", amountSompi: 100n, maxFeeSompi: 20n });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZKasSubmissionUncertainError);
    expect((caught as ZKasSubmissionUncertainError).txid).toBe(response instanceof Error ? undefined : txid);
    expect(calls.filter((call) => call.path.endsWith("/submit"))).toHaveLength(1);
  }
});

test("hostile or incomplete daemon responses never reach signing or submit", async () => {
  const cases = [
    { status: { ...goodStatus, network: "testnet" }, prepare: goodPrepare, error: /network/i },
    { status: { ...goodStatus, address: "zkas:attacker" }, prepare: goodPrepare, error: /address/i },
    { status: { ...goodStatus, synced: false }, prepare: goodPrepare, error: /sync/i },
    { status: { ...goodStatus, missing_history: true }, prepare: goodPrepare, error: /history/i },
    { status: goodStatus, prepare: { ...goodPrepare, amount_sompi_exact: "99" }, error: /amount/i },
    { status: goodStatus, prepare: { ...goodPrepare, fee_sompi_exact: "21" }, error: /fee/i },
    { status: goodStatus, prepare: { ...goodPrepare, remaining_sompi_exact: "1" }, error: /partial/i },
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
  await expect(client.state("f".repeat(192), goodStatus.address)).rejects.toThrow(/address/i);
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
  await expect(client.send({
    signer: fakeSigner().signer,
    to: "zkastest:recipient",
    amountSompi: 100n,
    maxFeeSompi: 20n,
  })).rejects.toThrow(/testnet/i);
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
  await expect(client.send({
    signer,
    to: "zkas:recipient",
    amountSompi: 100n,
    maxFeeSompi: 20n,
    beforeSubmit: async () => { throw new Error("Selected account changed"); },
  })).rejects.toThrow(/account changed/i);
  expect(verified).toHaveLength(1);
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
