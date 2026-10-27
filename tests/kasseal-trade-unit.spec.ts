import { expect, test } from "@playwright/test";
import {
  buyQuote,
  maxWithSlippage,
  minWithSlippage,
  runSubmission,
  sellQuote,
  swapKasForTokens,
  toKasScaled,
} from "@kassealhq/sdk";
import type { BuiltTx, FundingUtxo, SubmitState } from "@kassealhq/sdk";
import {
  buildTrade,
  BoundProof,
  KassealBuilder,
  KassealTradeError,
  kassealSubmissionEffects,
  lotsForBudget,
  quoteCurve,
  quotePool,
  requireBoundProof,
} from "@/lib/kasseal/trade";
import type { KassealTxStatus } from "@/lib/kasseal/api";
import { spliceAt } from "@/lib/kasseal/sign";

// Assert bigints via String(): a failing bigint toBe crash-loops the worker.
const s = (v: bigint | undefined) => String(v);

const CURVE = { p0: 100_000_000n, k: 3n, feeBps: 100n, curveLots: 10_000n };
const POOL = {
  kasScaled: toKasScaled(1_000_000_000_000n),
  tokenReserve: 500_000_000n,
  feeAccruedScaled: 0n,
  dust: 0n,
};

test.describe("Kasseal quotes", () => {
  test("a KAS budget buys the most lots whose total fits it", () => {
    const sold = 1_234n;
    const budget = buyQuote(CURVE, sold, 50n).total + 1n;
    const lots = lotsForBudget(CURVE, sold, budget);
    expect(s(lots)).toBe("50");
    expect(buyQuote(CURVE, sold, lots + 1n).total > budget).toBe(true);
  });

  test("curve buy pays the SDK quote and bounds it by max slippage", () => {
    const budget = buyQuote(CURVE, 0n, 10n).total;
    const q = quoteCurve("buy", CURVE, 0n, 1_000n, budget, 100);
    const exact = buyQuote(CURVE, 0n, 10n);
    expect(s(q.lots)).toBe("10");
    expect(s(q.amountIn)).toBe(s(exact.total));
    expect(s(q.amountOut)).toBe("10000");
    expect(s(q.feeSompi)).toBe(s(exact.fee));
    expect(s(q.bound)).toBe(s(maxWithSlippage(exact.total, 100)));
  });

  test("curve sell rounds down to whole lots and bounds proceeds by min slippage", () => {
    const q = quoteCurve("sell", CURVE, 500n, 1_000n, 7_999n, 300);
    const exact = sellQuote(CURVE, 500n, 7n);
    expect(s(q.lots)).toBe("7");
    expect(s(q.amountIn)).toBe("7000");
    expect(s(q.amountOut)).toBe(s(exact.total));
    expect(s(q.bound)).toBe(s(minWithSlippage(exact.total, 300)));
  });

  test("an amount under one lot is refused, never quoted as zero", () => {
    expect(() => quoteCurve("sell", CURVE, 500n, 1_000n, 999n, 100)).toThrow(
      KassealTradeError,
    );
    expect(() => quoteCurve("buy", CURVE, 0n, 1_000n, 1n, 100)).toThrow(
      KassealTradeError,
    );
  });

  test("pool buy matches swapKasForTokens and bounds tokens out", () => {
    const q = quotePool("buy", POOL, 100_000_000n, 100);
    const exact = swapKasForTokens(POOL, toKasScaled(100_000_000n));
    expect(s(q.amountOut)).toBe(s(exact.tokenOut));
    expect(s(q.bound)).toBe(s(minWithSlippage(exact.tokenOut, 100)));
  });
});

test.describe("Kasseal launch proof gate", () => {
  // The verifier needs the contract artifacts; the node entry installs them.
  test.beforeAll(async () => {
    await import("@kassealhq/sdk/node");
  });

  test("a malformed or unverified proof is never traded", () => {
    for (const json of [null, {}, { T: "aa", C: "bb" }]) {
      let err: unknown;
      try {
        requireBoundProof(json, "mainnet", "aa");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(KassealTradeError);
      expect((err as KassealTradeError).code).toBe("proof-not-bound");
    }
  });
});

const PROOF: BoundProof = { tokenId: "t".repeat(64), curveId: "c".repeat(64) };
const TRADER = { address: "kaspa:qtest", xOnlyPubkey: new Uint8Array(32) };

function capturingBuilder() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const record =
    (method: string) =>
    async (params: unknown): Promise<BuiltTx> => {
      calls.push({ method, params: params as Record<string, unknown> });
      return {} as BuiltTx;
    };
  const builder = {
    buildBuy: record("buildBuy"),
    buildSell: record("buildSell"),
    buildSwap: record("buildSwap"),
  } as unknown as KassealBuilder;
  return { builder, calls };
}

test.describe("Kasseal builds pin the proof's ids", () => {
  test("curve trades pass expectedCurveId and tokenId so CurveNotOfProof can fire", async () => {
    const { builder, calls } = capturingBuilder();
    const buy = quoteCurve("buy", CURVE, 0n, 1_000n, 10_000_000_000n, 100);
    await buildTrade(builder, PROOF, TRADER, buy);
    const sell = quoteCurve("sell", CURVE, 100n, 1_000n, 5_000n, 100);
    await buildTrade(builder, PROOF, TRADER, sell);

    expect(calls.map((c) => c.method)).toEqual(["buildBuy", "buildSell"]);
    for (const { params } of calls) {
      expect(params.covenantId).toBe(PROOF.tokenId);
      expect(params.tokenId).toBe(PROOF.tokenId);
      expect(params.expectedCurveId).toBe(PROOF.curveId);
      expect(params.proofVerdict).toBe("bound");
    }
    expect(s(calls[0].params.maxAllIn as bigint)).toBe(s(buy.bound));
    expect(s(calls[1].params.minNetOut as bigint)).toBe(s(sell.bound));
  });

  test("pool swaps pass expectedPoolId, and no bound pool means no build", async () => {
    const { builder, calls } = capturingBuilder();
    const q = quotePool("buy", POOL, 100_000_000n, 100);
    await buildTrade(builder, { ...PROOF, poolId: "p".repeat(64) }, TRADER, q);
    expect(calls[0].params.expectedPoolId).toBe("p".repeat(64));
    expect(calls[0].params.poolId).toBe("p".repeat(64));
    expect(s(calls[0].params.minOut as bigint)).toBe(s(q.bound));

    expect(() => buildTrade(builder, PROOF, TRADER, q)).toThrow(
      KassealTradeError,
    );
  });
});

const coin = (txid: string, index = 0) =>
  ({ outpoint: { txid, index } }) as unknown as FundingUtxo;

function fakeBuilt(txid: string, consumes: { txid: string; index: number }[]) {
  return {
    txid,
    txJson: "{}",
    consumes,
    inputsToSign: [],
    budgets: [],
    produces: [],
    feeSompi: 2_000n,
    feerate: 1n,
  } as unknown as BuiltTx;
}

function harness(opts: {
  post: (n: number, built: BuiltTx) => Promise<SubmitState>;
  status: (txid: string) => Promise<KassealTxStatus>;
}) {
  let t = 0;
  const requiredSeen: (ReadonlySet<string> | undefined)[] = [];
  let builds = 0;
  let posts = 0;
  const effects = kassealSubmissionEffects({
    makeBuilder: (required) => {
      requiredSeen.push(required);
      return {
        builder: {} as KassealBuilder,
        // The curve cell is not wallet funding; only the coin is pinned.
        lastFunding: () => [coin("f1")],
      };
    },
    build: async () => {
      builds += 1;
      return fakeBuilt(`tx${builds}`, [
        { txid: "f1", index: 0 },
        { txid: "curve", index: 0 },
      ]);
    },
    sign: async (built) => built,
    post: (built) => opts.post(++posts, built),
    status: opts.status,
    now: () => t,
    sleepUntil: async (until) => {
      t = Math.max(t, until);
    },
    pollMs: 10,
  });
  return {
    run: () => runSubmission(effects),
    stats: () => ({ builds, posts, requiredSeen }),
  };
}

test.describe("Kasseal submission", () => {
  test("a lost race rebuilds with the first build's funding pinned", async () => {
    const h = harness({
      post: async (n, built) =>
        n === 1
          ? { kind: "lost-race", txid: built.txid, cause: "mempool-spent" }
          : { kind: "submitted", txid: built.txid, at: 0 },
      status: async (txid) =>
        txid === "tx2"
          ? { kind: "accepted", txid, acceptingBlueScore: 7 }
          : { kind: "unknown" },
    });
    const result = await h.run();
    const { builds, requiredSeen } = h.stats();
    expect(result.outcome.kind).toBe("done");
    expect(builds).toBe(2);
    expect(requiredSeen[0]).toBeUndefined();
    expect([...requiredSeen[1]!]).toEqual(["f1:0"]);
  });

  test("an unanswered POST asks /tx first and never builds twice", async () => {
    const asked: string[] = [];
    const h = harness({
      post: async () => {
        throw new TypeError("Failed to fetch");
      },
      status: async (txid) => {
        asked.push(txid);
        return { kind: "accepted", txid, acceptingBlueScore: 9 };
      },
    });
    const result = await h.run();
    expect(asked[0]).toBe("tx1");
    expect(h.stats().builds).toBe(1);
    expect(result.outcome.kind).toBe("done");
  });
});

test.describe("Kasseal covenant signature splice", () => {
  test("a signature lands only on a zero placeholder at the offset", () => {
    const script = new Uint8Array(70).fill(7);
    script.fill(0, 3, 68);
    const sig = new Uint8Array(65).fill(1);
    const out = spliceAt(script, 3, sig);
    expect(Array.from(out.subarray(3, 68))).toEqual(Array.from(sig));
    expect(out[2]).toBe(7);
    expect(out[68]).toBe(7);
    expect(() => spliceAt(script, 2, sig)).toThrow("placeholder");
    expect(() => spliceAt(script, 3, sig.subarray(1))).toThrow("65 bytes");
  });
});
