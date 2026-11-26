import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";

// lib/kasseal/build.ts against a stubbed SDK, init and api: no WASM, no HTTP.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

function loadModule(file: string, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", outputText)(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`unexpected runtime import ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

const X = "11".repeat(32);
const OWN = `20${X}ac`;
const C = "curve-C";
const T = "token-T";
const LOT = 10n;
const S0 = 5n;

/** Buy 4 lots at 1000 + 10 fee each: the curve takes 4040, cell 1000, fee 500. */
const buyTx = () => ({
  txid: "buy-tx",
  feeSompi: 500n,
  txJson: JSON.stringify({
    inputs: [
      { utxo: { amount: "100000", covenantId: C } },
      { utxo: { amount: "50000", scriptPublicKey: OWN } },
    ],
    outputs: [
      { value: "104040", covenant: { covenantId: C } },
      { value: "1000", covenant: { covenantId: T } },
      { value: "44460", scriptPublicKey: OWN },
    ],
  }),
  inputsToSign: [
    { index: 0, kind: "p2sh-curve", signatureOffset: 1 },
    { index: 1, kind: "p2pk" },
  ],
  consumes: [{ txid: "fund", index: 1 }],
  produces: [{ index: 0, role: "curve" }],
  optimistic: {
    curve: { covenantId: C, amount: 104040n, state: { lotsSold: S0 + 4n } },
  },
});

/** Sell 2 lots: the curve pays 1980 net, fee 300, the wallet nets 1680. */
const sellTx = () => ({
  txid: "sell-tx",
  feeSompi: 300n,
  txJson: JSON.stringify({
    inputs: [
      { utxo: { amount: "100000", covenantId: C } },
      { utxo: { amount: "700", covenantId: T } },
      { utxo: { amount: "300", scriptPublicKey: OWN } },
    ],
    outputs: [
      { value: "98020", covenant: { covenantId: C } },
      { value: "700", covenant: { covenantId: T } },
      { value: "1980", scriptPublicKey: OWN },
    ],
  }),
  inputsToSign: [
    { index: 0, kind: "p2sh-curve", signatureOffset: 1 },
    { index: 1, kind: "p2sh-token", signatureOffset: 1 },
    { index: 2, kind: "p2pk" },
  ],
  consumes: [{ txid: "fund", index: 2 }],
  produces: [{ index: 0, role: "curve" }],
  optimistic: {
    curve: { covenantId: C, amount: 98020n, state: { lotsSold: S0 - 2n } },
  },
});

class FakeApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`${path} ${status}`);
  }
}

function setup(
  over: { init?: () => Promise<void>; serverQuote?: () => any } = {},
) {
  const log: string[] = [];
  const builders: any[] = [];
  const orders: any[] = [];
  const quote = (n: bigint) => ({ cost: n * 1000n, fee: n * 10n, total: 0n });
  const sdk = {
    buyQuote: (_p: unknown, _s0: bigint, n: bigint) => quote(n),
    sellQuote: (_p: unknown, _s0: bigint, n: bigint) => quote(n),
    minWithSlippage: (t: bigint, bps: number) => t - (t * BigInt(bps)) / 10000n,
    xOnlyKeyOfAddress: () => Uint8Array.from(Buffer.from(X, "hex")),
    errorCode: (e: any) => e?.errorCode,
    verifyLaunchProofJson: () => ({ status: "bound" }),
    launchProofFromJson: () => ({
      T,
      C,
      params: { p0: "1", k: "1", feeBps: 100, curveLots: "100", lot: "10" },
    }),
    createApiSources: (o: any) => {
      log.push(`sources:${o.network}`);
      return {
        curveHead: async () => ({ state: { lotsSold: S0 } }),
        lastFunding: () => [],
      };
    },
    createTxBuilder: (o: any) => {
      log.push(`builder:${o.networkId}`);
      const b = {
        options: o,
        buildBuy: async (order: any) => (orders.push(order), buyTx()),
        buildSell: async (order: any) => (orders.push(order), sellTx()),
      };
      builders.push(b);
      return b;
    },
    finalize: async (b: any, json: string) => ({ ...b, txJson: json }),
  };
  const api = {
    KassealApiError: FakeApiError,
    kassealBaseUrl: (n: string) => `https://api/${n}`,
    kassealNetworkOf: (n?: string) =>
      n === "mainnet" || n === "testnet-10" ? n : undefined,
    fetchLaunchProof: async () => (log.push("proof"), {}),
    fetchServerQuote:
      over.serverQuote ??
      (async (_u: string, _t: string, side: string, lots: bigint) => {
        log.push("serverQuote");
        const q = quote(lots);
        return {
          totalSompi: side === "buy" ? q.cost + q.fee : q.cost - q.fee,
          feeSompi: q.fee,
        };
      }),
    fetchTxStatus: async () => ({ kind: "unknown" }),
    postTx: async () => ({ kind: "submitted" }),
  };
  const init = {
    KassealReloadRequired: class extends Error {},
    initKasseal: async (n: string) => {
      log.push(`init:${n}`);
      return over.init?.();
    },
  };
  const prepared = loadModule("lib/kasseal/prepared.ts", {});
  const trade = loadModule("lib/kasseal/trade.ts", { "@kassealhq/sdk": sdk });
  const build = loadModule("lib/kasseal/build.ts", {
    "@kassealhq/sdk": sdk,
    "./init": init,
    "./api": api,
    "./prepared": prepared,
    "./trade": trade,
  });
  return { build, log, builders, orders, api };
}

const req = (side: "buy" | "sell", network = "testnet-10") => ({
  apiUrl: `https://api/${network}`,
  network,
  covenantId: T,
  side,
  amountIn: side === "buy" ? 5000n : 25n,
  slippageBps: 100,
  trader: "kaspatest:trader",
});

const tradeReq = (side: "buy" | "sell") => ({
  network: "testnet-10",
  covenantId: T,
  side,
  amountIn: side === "buy" ? 5000n : 25n,
  slippage: 1,
  trader: "kaspatest:trader",
});

test.describe("kasseal build: the popup's quote and trade deps", () => {
  test("no NOT_PORTED stub remains in components/ or lib/", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
      });
    const hits = ["components", "lib"]
      .flatMap((d) => walk(path.join(ROOT, d)))
      .filter((f) => fs.readFileSync(f, "utf8").includes("NOT_PORTED"));
    expect(hits).toEqual([]);
  });

  test("initKasseal runs first, on the settings network, before the server quote", async () => {
    const { build, log } = setup();
    await build.kassealQuoteClient(req("buy", "testnet-10"));
    expect(log[0]).toBe("init:testnet-10");
    expect(log.indexOf("init:testnet-10")).toBeLessThan(
      log.indexOf("serverQuote"),
    );
    expect(log).toContain("sources:testnet-10");
    expect(log).toContain("builder:testnet-10");

    // A failed init reads nothing and refuses as UNAVAILABLE.
    const down = setup({ init: () => Promise.reject(new Error("offline")) });
    await expect(down.build.kassealQuoteClient(req("buy"))).rejects.toThrow(
      /^KASSEAL_UNAVAILABLE$/,
    );
    expect(down.log).toEqual(["init:testnet-10"]);
  });

  test("buy preview comes off the built tx; sell-only fields stay absent", async () => {
    const { build, orders } = setup();
    const p = await build.kassealQuoteClient(req("buy"));
    expect(p).toEqual({
      side: "buy",
      amountIn: "4040",
      walletDebitSompi: "5540",
      minOut: String(4n * LOT),
      expectedOut: String(4n * LOT),
      feeSompi: "500",
      tradingFeeSompi: "40",
    });
    expect("walletCreditSompi" in p).toBe(false);
    expect("tokenCellSompi" in p).toBe(false);
    // Second build is capped at the debit the first build showed.
    expect(String(orders[1].maxAllIn)).toBe("5540");
  });

  test("sell preview: credit known, debit absent (never 0)", async () => {
    const { build } = setup();
    const p = await build.kassealQuoteClient(req("sell"));
    expect(p).toEqual({
      side: "sell",
      amountIn: "20",
      tokenCellSompi: "0",
      walletCreditSompi: "1680",
      minOut: String(1980n - (1980n * 100n) / 10000n),
      expectedOut: "1980",
      feeSompi: "300",
      tradingFeeSompi: "20",
    });
    expect("walletDebitSompi" in p).toBe(false);
  });

  test("makeBuilder pins the set; build returns the SDK's BuiltTx with its consumes", async () => {
    const { build, builders } = setup();
    const deps = build.kassealTradeDeps(tradeReq("buy"));
    // No quote for this trade yet: nothing is built.
    expect(() => deps.makeBuilder()).toThrow(
      /^KASSEAL_BUILD_FAILED:QUOTE_MOVED$/,
    );

    await build.kassealQuoteClient(req("buy"));
    const pinned = new Set(["fund:1"]);
    const { builder } = deps.makeBuilder(pinned);
    expect(builders.at(-1).options.fundingOptions.required).toBe(pinned);
    const built = await deps.build(builder);
    expect(built.txid).toBe("buy-tx");
    expect(built.consumes).toEqual([{ txid: "fund", index: 1 }]);

    // Another amount was never quoted: refused, not built off a stale quote.
    const other = build.kassealTradeDeps({
      ...tradeReq("buy"),
      amountIn: 6000n,
    });
    expect(() => other.makeBuilder()).toThrow(/QUOTE_MOVED/);
  });

  test("a transport failure is a BUILD_FAILED transport reason, not a refusal code", async () => {
    const down = setup({
      serverQuote: () => Promise.reject(new FakeApiError("/quote", 503)),
    });
    const e1 = await down.build
      .kassealQuoteClient(req("buy"))
      .catch((e: Error) => e);
    expect(e1.message).toBe("KASSEAL_BUILD_FAILED:HTTP_503:QUOTE");

    const offline = setup({
      serverQuote: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const e2 = await offline.build
      .kassealQuoteClient(req("buy"))
      .catch((e: Error) => e);
    expect(e2.message).toBe("KASSEAL_BUILD_FAILED:NET:QUOTE");

    // The hook's own transport test (useKassealSwap.kassealBuildIsTransport).
    const transport = (m: string) =>
      /^NET:[A-Z_]+$/.test(m) || /^HTTP_(?:429|5[0-9]{2}):[A-Z_]+$/.test(m);
    for (const e of [e1, e2])
      expect(transport(e.message.slice("KASSEAL_BUILD_FAILED:".length))).toBe(
        true,
      );
  });
});
