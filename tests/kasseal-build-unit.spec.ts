import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { buyQuote, minWithSlippage, sellQuote } from "@kassealhq/sdk";

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

/**
 * Buy 4 lots at 1000 + 10 fee each: the curve takes 4040, cell 1000, fee 500.
 * Real shape: the curve's supply cell (covenant T, never signed by the wallet)
 * is spent and written back; only the wallet's P2PK input is signed.
 */
const buyTx = () => ({
  txid: "buy-tx",
  feeSompi: 500n,
  txJson: JSON.stringify({
    inputs: [
      { utxo: { amount: "100000", covenantId: C } },
      { utxo: { amount: "2000", covenantId: T } },
      { utxo: { amount: "50000", scriptPublicKey: OWN } },
    ],
    outputs: [
      { value: "104040", covenant: { covenantId: C } },
      { value: "2000", covenant: { covenantId: T } },
      { value: "1000", covenant: { covenantId: T } },
      { value: "44460", scriptPublicKey: OWN },
    ],
  }),
  inputsToSign: [{ index: 2, kind: "p2pk" }],
  consumes: [{ txid: "fund", index: 1 }],
  produces: [
    { index: 0, role: "curve" },
    { index: 1, role: "token-rest" },
    { index: 2, role: "token-user" },
    { index: 3, role: "change" },
  ],
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
    { index: 1, kind: "p2sh-leader", signatureOffset: 1 },
    { index: 2, kind: "p2pk" },
  ],
  consumes: [{ txid: "fund", index: 2 }],
  produces: [{ index: 0, role: "curve" }],
  optimistic: {
    curve: { covenantId: C, amount: 98020n, state: { lotsSold: S0 - 2n } },
  },
});

/** A build captured off mainnet with the real SDK builder (tests/fixtures). */
type RealFixture = {
  tokenId: string;
  curveId: string;
  trader: string;
  xOnly: string;
  side: "buy" | "sell";
  amountIn: string;
  slippageBps: number;
  params: Record<string, string>;
  head: { lotsSold: bigint };
  serverQuote: { totalSompi: string; feeSompi: string };
  built: any;
  previewAfterFix: Record<string, string>;
};

/** Bigints were written as { $n }: revived so the tx reads as the SDK handed it. */
const loadReal = (name: string): RealFixture =>
  JSON.parse(read(`tests/fixtures/${name}`), (_k, v) =>
    v && typeof v === "object" && typeof v.$n === "string" ? BigInt(v.$n) : v,
  );

class FakeApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`${path} ${status}`);
  }
}

function setup(
  over: {
    init?: () => Promise<void>;
    serverQuote?: () => any;
    /** Replay a captured mainnet build through the real curve math. */
    real?: RealFixture;
  } = {},
) {
  const fx = over.real;
  const log: string[] = [];
  const builders: any[] = [];
  const orders: any[] = [];
  const quote = (n: bigint) => ({ cost: n * 1000n, fee: n * 10n, total: 0n });
  const sdk = {
    buyQuote: fx ? buyQuote : (_p: unknown, _s0: bigint, n: bigint) => quote(n),
    sellQuote: fx
      ? sellQuote
      : (_p: unknown, _s0: bigint, n: bigint) => quote(n),
    minWithSlippage: fx
      ? minWithSlippage
      : (t: bigint, bps: number) => t - (t * BigInt(bps)) / 10000n,
    xOnlyKeyOfAddress: () =>
      Uint8Array.from(Buffer.from(fx ? fx.xOnly : X, "hex")),
    errorCode: (e: any) => e?.errorCode,
    verifyLaunchProofJson: () => ({ status: "bound" }),
    launchProofFromJson: () =>
      fx
        ? { T: fx.tokenId, C: fx.curveId, params: fx.params }
        : {
            T,
            C,
            params: {
              p0: "1",
              k: "1",
              feeBps: 100,
              curveLots: "100",
              lot: "10",
            },
          },
    createApiSources: (o: any) => {
      log.push(`sources:${o.network}`);
      return {
        curveHead: async () => ({
          state: { lotsSold: fx ? fx.head.lotsSold : S0 },
        }),
        lastFunding: () => [],
      };
    },
    createTxBuilder: (o: any) => {
      log.push(`builder:${o.networkId}`);
      const b = {
        options: o,
        buildBuy: async (order: any) => (
          orders.push(order), fx ? structuredClone(fx.built) : buyTx()
        ),
        buildSell: async (order: any) => (
          orders.push(order), fx ? structuredClone(fx.built) : sellTx()
        ),
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
      (fx &&
        (async () => ({
          totalSompi: BigInt(fx.serverQuote.totalSompi),
          feeSompi: BigInt(fx.serverQuote.feeSompi),
        }))) ??
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

  test.describe("real mainnet builds (tests/fixtures/kasseal-*.real.json)", () => {
    const quoteOf = (fx: RealFixture) => ({
      apiUrl: "https://app.kasseal.com/v1",
      network: "mainnet",
      covenantId: fx.tokenId,
      side: fx.side,
      amountIn: BigInt(fx.amountIn),
      slippageBps: fx.slippageBps,
      trader: fx.trader,
    });
    const inputs = (fx: RealFixture) => JSON.parse(fx.built.txJson).inputs;

    test("a curve buy spends the curve's supply cell: KPEPE 2 KAS reconciles", async () => {
      const fx = loadReal("kasseal-buy-KPEPE.real.json");
      // The shape every live buy refused on (2026-11-26): input 1 carries the
      // token's covenant id and is not one the wallet signs.
      expect(inputs(fx).map((x: any) => x.utxo.covenantId)).toEqual([
        fx.curveId,
        fx.tokenId,
        null,
      ]);
      expect(fx.built.inputsToSign.map((s: any) => s.index)).toEqual([2]);

      const { build } = setup({ real: fx });
      const p = await build.kassealQuoteClient(quoteOf(fx));
      expect(p).toEqual(fx.previewAfterFix);
      // 15 lots: price 1.98976707 + the buyer's new 5 KAS token cell + fee.
      expect(p).toEqual({
        side: "buy",
        amountIn: "198976707",
        walletDebitSompi: String(198976707n + 500000000n + 2624400n),
        minOut: "15000",
        expectedOut: "15000",
        feeSompi: "2624400",
        tradingFeeSompi: "1970067",
      });

      // The confirm-time rebuild reads the same tx through the same check.
      const deps = build.kassealTradeDeps({
        network: "mainnet",
        covenantId: fx.tokenId,
        side: "buy",
        amountIn: BigInt(fx.amountIn),
        slippage: fx.slippageBps / 100,
        trader: fx.trader,
      });
      const built = await deps.build(deps.makeBuilder().builder);
      expect(built.txid).toBe(fx.built.txid);
    });

    test("a curve buy locks 0.5 KAS in the buyer's cell: KPEPE 2 KAS debit = price + fee + cell", async () => {
      const fx = loadReal("kasseal-buy-KPEPE-cell.real.json");
      const { build, orders } = setup({ real: fx });
      // Strings, not bigints: a failing bigint expect crash-loops the worker.
      const CELL = "50000000"; // 0.5 KAS
      expect(String(build.KASSEAL_USER_CELL_SOMPI)).toBe(CELL);
      const p = await build.kassealQuoteClient(quoteOf(fx));
      // Both builds (cap probe + held order) ask the SDK for the 0.5 KAS cell.
      expect(orders.map((o) => String(o.userCellValue))).toEqual([CELL, CELL]);
      const cell = fx.built.produces.find((o: any) => o.role === "token-user");
      expect(JSON.parse(fx.built.txJson).outputs[cell.index].value).toBe(CELL);
      expect(p).toEqual(fx.previewAfterFix);
      expect(p.walletDebitSompi).toBe(
        String(
          BigInt(fx.serverQuote.totalSompi) + fx.built.feeSompi + BigInt(CELL),
        ),
      );
    });

    test("a buy that would also spend a token cell the wallet signs is refused", async () => {
      // The supply cell stays (index 2); the wallet's own token cell is added
      // in front of it, balanced by a like output, and the wallet's P2PK
      // input moves to 3. Only the signed-token rule can refuse this.
      const fx = loadReal("kasseal-buy-KPEPE.real.json");
      const tx = JSON.parse(fx.built.txJson);
      tx.inputs.splice(1, 0, tx.inputs[1]);
      tx.outputs.splice(1, 0, tx.outputs[1]);
      fx.built.txJson = JSON.stringify(tx);
      fx.built.inputsToSign = [
        { index: 1, kind: "p2sh-leader", sighashType: 1, signatureOffset: 1 },
        { index: 3, kind: "p2pk", sighashType: 1 },
      ];
      const { build } = setup({ real: fx });
      await expect(build.kassealQuoteClient(quoteOf(fx))).rejects.toThrow(
        /^KASSEAL_PREVIEW_UNRECONCILED$/,
      );
    });

    test("a buy with no supply cell, or two, is refused", async () => {
      const edit = (f: (tx: any) => void) => {
        const fx = loadReal("kasseal-buy-KPEPE.real.json");
        const tx = JSON.parse(fx.built.txJson);
        f(tx);
        fx.built.txJson = JSON.stringify(tx);
        return fx;
      };
      // Each edit keeps the tx balanced against its fee, so only the supply
      // rule can refuse it. Index 2 (the wallet's input) moves with it.
      const none = edit((tx) => {
        tx.inputs.splice(1, 1);
        tx.outputs.splice(1, 1);
      });
      none.built.inputsToSign = [{ index: 1, kind: "p2pk", sighashType: 1 }];
      const two = edit((tx) => {
        tx.inputs.splice(1, 0, tx.inputs[1]);
        tx.outputs.splice(1, 0, tx.outputs[1]);
      });
      two.built.inputsToSign = [{ index: 3, kind: "p2pk", sighashType: 1 }];
      for (const fx of [none, two]) {
        const { build } = setup({ real: fx });
        await expect(build.kassealQuoteClient(quoteOf(fx))).rejects.toThrow(
          /^KASSEAL_PREVIEW_UNRECONCILED$/,
        );
      }
    });

    test("a curve sell spends the wallet's signed cell and the supply cell: KPEPE 77,000 reconciles", async () => {
      const fx = loadReal("kasseal-sell-KPEPE.real.json");
      expect(inputs(fx).map((x: any) => x.utxo.covenantId)).toEqual([
        fx.tokenId,
        fx.tokenId,
        fx.curveId,
      ]);
      expect(fx.built.inputsToSign.map((s: any) => [s.index, s.kind])).toEqual([
        [0, "p2sh-leader"],
      ]);
      const { build } = setup({ real: fx });
      const p = await build.kassealQuoteClient(quoteOf(fx));
      expect(p).toEqual(fx.previewAfterFix);
      expect(p.walletCreditSompi).toBe("1047246865");
    });

    test("a sell that spends two supply cells is refused", async () => {
      // A second unsigned token-T input (a copy of the supply cell, index 1)
      // and its like output are appended: the tx still balances against its
      // fee, the signed cell stays at 0, the token delta is unchanged. Only
      // the at-most-one supply-cell rule can refuse this.
      const fx = loadReal("kasseal-sell-KPEPE.real.json");
      const tx = JSON.parse(fx.built.txJson);
      const supply = tx.inputs[1];
      expect(supply.utxo.covenantId).toBe(fx.tokenId);
      expect(fx.built.inputsToSign.some((s: any) => s.index === 1)).toBe(false);
      const back = tx.outputs.find(
        (o: any) =>
          o.covenant?.covenantId === fx.tokenId &&
          o.value === supply.utxo.amount,
      );
      tx.inputs.push(structuredClone(supply));
      tx.outputs.push(structuredClone(back));
      fx.built.txJson = JSON.stringify(tx);
      const { build } = setup({ real: fx });
      await expect(build.kassealQuoteClient(quoteOf(fx))).rejects.toThrow(
        /^KASSEAL_PREVIEW_UNRECONCILED$/,
      );
    });
  });
});
