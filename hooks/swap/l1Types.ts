import { BRAID_PENDING_COPY } from "@/lib/braid/constants";
import type { DiagnosticReport } from "@/lib/diagnostics";

export type Money = { amount: number; symbol: string };

export type FeeLine = {
  name: string;
  symbol: "KAS";
  /** Unknown is absent, never 0. */
  amount?: number;
  /** What the Est. Fee row shows. */
  display: string;
  hint: string;
};

/**
 * What a Kaspa L1 swap provider hook (every one but KRON, which the screen
 * still builds inline) hands the swap screen. Field for field what
 * useBraidSwap returns, with the quote narrowed to what the screen reads.
 */
export type L1SwapHandlers = {
  side: "buy" | "sell";
  quote?: { amountOut: bigint };
  /** A swap for this pair is still settling: confirm stays disabled. */
  pending: boolean;
  /** The confirm label while `pending`; absent: Braid's copy (l1PendingCopy). */
  pendingCopy?: string;
  isSigning: boolean;
  isLoading: boolean;
  validateAmount: (units: bigint) => string | undefined;
  findMax: () => string | undefined;
  onConfirm: () => Promise<void>;
  /** The last failed confirm's "Copy logs"; null: scrubbing failed. */
  report: DiagnosticReport | null | undefined;
  extraErrorMessage: string | undefined;
  /** Shown in amber; must be confirmed, never blocks on its own. */
  routeWarning?: string;
  /** Shown under the quote, never blocking. */
  advisory: readonly string[];
  minOut?: bigint;
  /** Network first; Kastle is summed by the fee summary; the rest get a row each. */
  feeLines: FeeLine[];
  kastleFeeBps: number;
  rate?: number;
  /** Everything the built tx takes from the wallet (Kasseal curve buy); its own row. */
  totalDebit?: Money;
  /** Signed credits read off the tx; never part of the fee sum. */
  creditLines?: FeeLine[];
};

/** What the confirm button says while a provider's swap is pending. */
export const l1PendingCopy = (l1: Pick<L1SwapHandlers, "pendingCopy">) =>
  l1.pendingCopy ?? BRAID_PENDING_COPY;
