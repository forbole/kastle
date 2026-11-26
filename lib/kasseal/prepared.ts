/**
 * The read half of mobile's lib/kasseal/prepared.ts: the preview a Kasseal
 * quote hands the swap screen, the refusal codes it may throw, and the
 * slippage ceiling. Signing types (inputsToSign, handle, finalize) are S2b-2.
 */

/** The SDK's own ceiling (MAX_SLIPPAGE_BPS = 1000): the app clamps to it. */
export const KASSEAL_MAX_SLIPPAGE_BPS = 1000;

/** The screen's slippage percent as the bps a quote is keyed and built under. */
export const kassealSlippageBps = (pct: number): number =>
  Math.min(KASSEAL_MAX_SLIPPAGE_BPS, Math.max(0, Math.round(pct * 100)));

export type KassealPreview = {
  side: "buy" | "sell";
  /** Sompi in on a buy, token base units in on a sell. */
  amountIn: string;
  /** Curve buy only: sompi the built tx takes from the wallet (its p2pk inputs less its change). */
  walletDebitSompi?: string;
  /**
   * Curve sell only, signed sompi: KAS the seller's token cells gave up into the
   * wallet (sell-all, consolidation), negative when they took some of the payout.
   */
  tokenCellSompi?: string;
  /** Curve sell only: sompi the built tx adds to the wallet (its change less its p2pk inputs), always > 0. */
  walletCreditSompi?: string;
  /** The floor the built covenant spend enforces, in out units. */
  minOut: string;
  /** The SDK pool/curve-math quote the floor was taken from, in out units. */
  expectedOut: string;
  /** Network fee the built tx pays, sompi; absent until a tx is built (mobile always builds first). */
  feeSompi?: string;
  /** Pool or curve trading fee, sompi; null when the SDK result did not carry one. */
  tradingFeeSompi: string | null;
};

/** Every code a Kasseal quote may refuse with, as `CODE` or `CODE:DETAIL`. */
export const KASSEAL_ERRORS = {
  UNAVAILABLE: "KASSEAL_UNAVAILABLE",
  BAD_PARAMS: "KASSEAL_BAD_PARAMS",
  SLIPPAGE: "KASSEAL_SLIPPAGE_OUT_OF_RANGE",
  BUILD_FAILED: "KASSEAL_BUILD_FAILED",
  /** The token's bound launch proof names no pool: nothing was built. */
  NO_POOL: "KASSEAL_NO_POOL",
  /** A bonding token whose curve params/head cannot be read, or whose build needs a pool. */
  CURVE_UNUSABLE: "KASSEAL_CURVE_UNUSABLE",
  /** A curve build whose own inputs/outputs do not reconcile to the wallet, the curve and the network fee. */
  PREVIEW_UNRECONCILED: "KASSEAL_PREVIEW_UNRECONCILED",
} as const;

/** The code an error carries: the message up to the first ':'. */
export const kassealCodeOf = (e: unknown): string =>
  String((e as Error)?.message ?? e).split(":")[0];
