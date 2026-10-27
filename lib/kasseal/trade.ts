import {
  buyQuote,
  errorCode,
  fromKasScaled,
  launchProofFromJson,
  maxWithSlippage,
  minWithSlippage,
  outpointKey,
  runSubmission,
  sellQuote,
  swapKasForTokens,
  swapTokensForKas,
  toKasScaled,
  verifyLaunchProofJson,
} from "@kassealhq/sdk";
import type {
  BuiltTx,
  CurveMathParams,
  FundingUtxo,
  KassealNetwork,
  PoolState,
  PublicTxBuilder,
  SubmissionEffects,
  SubmitState,
} from "@kassealhq/sdk";
import type { KassealTxStatus } from "./api";

export type KassealSide = "buy" | "sell";
export type KassealVenue = "curve" | "pool";

export type KassealTradeErrorCode =
  | "proof-not-bound"
  | "wrong-token"
  | "no-pool"
  | "invalid-amount"
  // A POST went out but the trade did not complete: it may still land.
  | "outcome-unknown";

export class KassealTradeError extends Error {
  constructor(
    readonly code: KassealTradeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KassealTradeError";
  }
}

/** The ids a verified launch proof binds; every build pins them. */
export interface BoundProof {
  tokenId: string;
  curveId: string;
  poolId?: string;
}

/**
 * Trades only on a `bound` verdict, and only for the token the route names:
 * a proof for another token would pin the wrong curve and pool ids.
 */
export function requireBoundProof(
  json: unknown,
  network: KassealNetwork,
  covenantId: string,
): BoundProof {
  const report = verifyLaunchProofJson(json, network);
  if (report.status !== "bound") {
    throw new KassealTradeError(
      "proof-not-bound",
      `launch proof is ${report.status}${report.reason ? `: ${report.reason}` : ""}`,
    );
  }
  const bundle = launchProofFromJson(json);
  if (bundle.T !== covenantId) {
    throw new KassealTradeError(
      "wrong-token",
      `launch proof is for ${bundle.T}, not ${covenantId}`,
    );
  }
  return {
    tokenId: bundle.T,
    curveId: bundle.C,
    poolId: bundle.graduation?.P,
  };
}

export interface KassealQuote {
  side: KassealSide;
  venue: KassealVenue;
  /** Curve lots traded; undefined on the pool. */
  lots?: bigint;
  /** Sompi paid (buy) or token base units sold (sell). */
  amountIn: bigint;
  /** Token base units (buy) or sompi (sell) received at the quoted price. */
  amountOut: bigint;
  feeSompi: bigint;
  /** The slippage bound written into the build: max paid or min received. */
  bound: bigint;
}

export type KassealBoundKind = "max-paid" | "min-received";

/** Only a curve buy caps the KAS paid; a pool buy floors the tokens received. */
export function boundKind(quote: KassealQuote): KassealBoundKind {
  return quote.side === "buy" && quote.venue === "curve"
    ? "max-paid"
    : "min-received";
}

/** Most lots a sompi budget buys at the curve's current position. */
export function lotsForBudget(
  p: CurveMathParams,
  lotsSold: bigint,
  budgetSompi: bigint,
): bigint {
  let lo = 0n;
  let hi = p.curveLots - lotsSold;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (buyQuote(p, lotsSold, mid).total <= budgetSompi) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export function quoteCurve(
  side: KassealSide,
  p: CurveMathParams,
  lotsSold: bigint,
  lotSize: bigint,
  amountIn: bigint,
  slippageBps: number,
): KassealQuote {
  if (side === "buy") {
    const lots = lotsForBudget(p, lotsSold, amountIn);
    if (lots === 0n)
      throw new KassealTradeError("invalid-amount", "amount buys no lots");
    const q = buyQuote(p, lotsSold, lots);
    return {
      side,
      venue: "curve",
      lots,
      amountIn: q.total,
      amountOut: lots * lotSize,
      feeSompi: q.fee,
      bound: maxWithSlippage(q.total, slippageBps),
    };
  }
  const lots = amountIn / lotSize;
  if (lots === 0n)
    throw new KassealTradeError("invalid-amount", "amount is under one lot");
  const q = sellQuote(p, lotsSold, lots);
  return {
    side,
    venue: "curve",
    lots,
    amountIn: lots * lotSize,
    amountOut: q.total,
    feeSompi: q.fee,
    bound: minWithSlippage(q.total, slippageBps),
  };
}

export function quotePool(
  side: KassealSide,
  pool: PoolState,
  amountIn: bigint,
  slippageBps: number,
): KassealQuote {
  if (amountIn <= 0n)
    throw new KassealTradeError("invalid-amount", "amount must be positive");
  if (side === "buy") {
    const r = swapKasForTokens(pool, toKasScaled(amountIn));
    return {
      side,
      venue: "pool",
      amountIn,
      amountOut: r.tokenOut,
      feeSompi: fromKasScaled(r.fee.total),
      bound: minWithSlippage(r.tokenOut, slippageBps),
    };
  }
  const r = swapTokensForKas(pool, amountIn);
  const out = fromKasScaled(r.kasOutScaled);
  return {
    side,
    venue: "pool",
    amountIn,
    amountOut: out,
    feeSompi: fromKasScaled(r.fee.total),
    bound: minWithSlippage(out, slippageBps),
  };
}

export interface KassealTrader {
  address: string;
  xOnlyPubkey: Uint8Array;
}

export type KassealBuilder = Pick<
  PublicTxBuilder,
  "buildBuy" | "buildSell" | "buildSwap"
>;

/** Unsigned build; proof ids are always passed so a swapped venue fails the build. */
export function buildTrade(
  builder: KassealBuilder,
  proof: BoundProof,
  trader: KassealTrader,
  quote: KassealQuote,
): Promise<BuiltTx> {
  if (quote.venue === "curve") {
    const common = {
      covenantId: proof.tokenId,
      expectedCurveId: proof.curveId,
      tokenId: proof.tokenId,
      lots: quote.lots!,
      proofVerdict: "bound" as const,
    };
    return quote.side === "buy"
      ? builder.buildBuy({
          ...common,
          buyer: trader.address,
          buyerXOnlyPubkey: trader.xOnlyPubkey,
          maxAllIn: quote.bound,
        })
      : builder.buildSell({
          ...common,
          seller: trader.address,
          sellerXOnlyPubkey: trader.xOnlyPubkey,
          minNetOut: quote.bound,
        });
  }
  if (!proof.poolId)
    throw new KassealTradeError("no-pool", "launch proof binds no pool");
  return builder.buildSwap({
    poolId: proof.poolId,
    expectedPoolId: proof.poolId,
    tokenId: proof.tokenId,
    trader: trader.address,
    traderXOnlyPubkey: trader.xOnlyPubkey,
    side: quote.side === "buy" ? "kas->tok" : "tok->kas",
    amountIn: quote.amountIn,
    proofVerdict: "bound",
    ...(quote.side === "buy"
      ? { minOut: quote.bound }
      : { minNetOut: quote.bound }),
  });
}

/** Funding coins a build spent, as `fundingOptions.required` keys. */
export function fundingConsumed(
  built: BuiltTx,
  funding: readonly FundingUtxo[],
): Set<string> {
  const ours = new Set(funding.map((f) => outpointKey(f.outpoint)));
  return new Set(
    built.consumes.map(outpointKey).filter((key) => ours.has(key)),
  );
}

export interface KassealSubmissionDeps {
  /** A fresh builder; `required` pins the funding coins of the first build. */
  makeBuilder(required?: ReadonlySet<string>): {
    builder: KassealBuilder;
    lastFunding(): readonly FundingUtxo[];
  };
  build(builder: KassealBuilder): Promise<BuiltTx>;
  sign(built: BuiltTx): Promise<BuiltTx>;
  post(built: BuiltTx): Promise<SubmitState>;
  status(txid: string): Promise<KassealTxStatus>;
  onState?(state: SubmitState, built: BuiltTx | undefined): void;
  now?(): number;
  sleepUntil?(t: number): Promise<void>;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One trade across "Try again": the first build's funding coins and every
 * txid whose POST may have reached the node. It outlives a give-up, so a
 * retry rebuilds on the same coins instead of funding a second trade.
 */
export interface KassealAttempt {
  pinned?: Set<string>;
  posted: string[];
}

export const newKassealAttempt = (): KassealAttempt => ({ posted: [] });

/**
 * `runSubmission` effects. Rebuilds pin the first build's funding coins, so
 * an attempt that landed after all makes the rebuild fail (PinnedFundingGone)
 * instead of paying twice; an unanswered POST asks `/tx/{txid}` before
 * anything else and never triggers a rebuild on its own.
 */
export function kassealSubmissionEffects(
  deps: KassealSubmissionDeps,
  attempt: KassealAttempt = newKassealAttempt(),
): SubmissionEffects {
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? 1_000;

  return {
    clock: { now },
    sleepUntil: deps.sleepUntil ?? ((t) => sleep(Math.max(0, t - now()))),
    async build() {
      const { builder, lastFunding } = deps.makeBuilder(attempt.pinned);
      const built = await deps.build(builder);
      attempt.pinned ??= fundingConsumed(built, lastFunding());
      return built;
    },
    sign: deps.sign,
    async submit(built): Promise<SubmitState> {
      if (!attempt.posted.includes(built.txid)) attempt.posted.push(built.txid);
      try {
        return await deps.post(built);
      } catch {
        const seen = await deps.status(built.txid).catch(() => undefined);
        if (!seen || seen.kind === "unknown") {
          // Outcome unknown: wait on acceptance, never rebuild blind.
          return { kind: "submitted", txid: built.txid, at: now() };
        }
        if (seen.kind === "dropped") {
          return {
            kind: "lost-race",
            txid: built.txid,
            cause: "mempool-spent",
          };
        }
        return seen as SubmitState;
      }
    },
    // Budgets are not patched in place; the machine falls back to a rebuild.
    patchBudget: () => undefined,
    async waitForAcceptance(txid, until) {
      while (now() < until) {
        const s = await deps.status(txid).catch(() => undefined);
        if (s?.kind === "accepted") return s.acceptingBlueScore;
        if (s?.kind === "confirmed") return 0;
        await sleep(Math.min(pollMs, Math.max(0, until - now())));
      }
      return undefined;
    },
    async status(txid) {
      const s = await deps.status(txid);
      if (s.kind === "accepted" || s.kind === "confirmed") return "accepted";
      if (s.kind === "submitted" || s.kind === "already-in-mempool")
        return "in-mempool";
      return "unknown";
    },
    onState: deps.onState,
  };
}

const LANDED = new Set([
  "submitted",
  "already-in-mempool",
  "accepted",
  "confirmed",
]);

/**
 * One press of Confirm. A retry first asks `/tx` about every earlier POST and
 * returns a txid the node has seen; otherwise it rebuilds on the pinned
 * coins. Failing after a POST reports "outcome-unknown", never "nothing sent".
 */
export async function submitKassealTrade(
  deps: KassealSubmissionDeps,
  attempt: KassealAttempt,
): Promise<string> {
  try {
    for (const txid of attempt.posted) {
      // Unreadable status counts as unseen: the pinned coins still stop a
      // second payment if it lands later.
      const s = await deps.status(txid).catch(() => undefined);
      if (s && LANDED.has(s.kind)) return txid;
    }
    const { outcome } = await runSubmission(
      kassealSubmissionEffects(deps, attempt),
    );
    if (outcome.kind === "give-up") throw new Error(outcome.reason);
    return outcome.kind === "done" ? outcome.txid : outcome.newTxid;
  } catch (e) {
    // PinnedFundingGone already says the earlier attempt may have landed.
    if (attempt.posted.length === 0 || errorCode(e) === "PINNED_FUNDING_GONE")
      throw e;
    throw new KassealTradeError("outcome-unknown", String(e));
  }
}
