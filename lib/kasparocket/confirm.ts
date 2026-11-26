import { transactionId } from "@dotk/sdk-tx";
import {
  KaspaRocketError,
  type Quote,
  type TransactionPlan,
  type UnsignedTransaction,
} from "@kasparocket/sdk";
import type { FeeLine } from "@/hooks/swap/l1Types";
import { KaspaRocketTxFormatError, kasparocketPlanToTx } from "./adapter";
import { kaspaRocketErrorCopy } from "./client";
import {
  kaspaRocketFeeLine,
  kaspaRocketMinOrderError,
  kaspaRocketNetworkFeeLine,
  kaspaRocketPlanFeeLine,
  type KaspaRocketFees,
} from "./fees";
import {
  claimKaspaRocketPair,
  clearPendingKaspaRocket,
  kaspaRocketRef,
  releaseKaspaRocketPair,
  savePendingKaspaRocket,
  type KaspaRocketChainOutcome,
} from "./pending";
import {
  KASPAROCKET_PLAN_TTL_MS,
  KaspaRocketPlanExpired,
  KaspaRocketSignRefusal,
  kaspaRocketPriceMoved,
  kastleKaspaRocketSigner,
  type KaspaRocketSignDigest,
} from "./signer";

// The swap screen's KaspaRocket confirm, fee lines and amount check, kept
// out of hooks/swap/useKaspaRocketSwap.ts so they run without React.

// Mobile's copy, verbatim.
export const KASPAROCKET_OFF_COPY = "KaspaRocket swaps are not available.";
export const KASPAROCKET_NO_POOL_COPY = "This token has no KaspaRocket pool.";
export const KASPAROCKET_PENDING_COPY =
  "A KaspaRocket swap on this pair is still settling.";
export const KASPAROCKET_UNECONOMIC_COPY =
  "This amount is too small to trade on KaspaRocket after fees.";
export const PRICE_MOVED_COPY =
  "Price moved. Review the new quote and swipe again.";
export const KASPAROCKET_PLAN_EXPIRED_COPY =
  "This quote expired. Review the refreshed one and swipe again.";
export const KASPAROCKET_CHANGED_COPY =
  "The amount changed. Review the new quote and swipe again.";
export const KASPAROCKET_UNKNOWN_COPY = "Swap may be settling. Check Activity.";
/** Kasseal's wording (useKassealSwap); not imported: its graph loads SVGs. */
export const NOT_ENOUGH_FUNDS_COPY = "Oh, you don't have enough funds";
export const PREPARE_COPY = "Unable to prepare the swap. Please try again.";

/** How often a stored swap is checked against the chain while it is open. */
export const KASPAROCKET_SETTLE_POLL_MS = 5_000;

/** Every transaction id of the plan, in submit order; known before broadcast. */
export function kaspaRocketPlanTxids(plan: TransactionPlan): string[] {
  return plan.transactions.map(({ tx }) => {
    const id = (tx as { id?: unknown }).id;
    return typeof id === "string" && id
      ? id
      : transactionId(kasparocketPlanToTx(tx));
  });
}

/**
 * Landed only when the explorer reports every txid accepted. Anything else,
 * a lookup failure included, is unknown: the pair stays blocked.
 */
export async function kaspaRocketChainCheck(
  txids: readonly string[],
): Promise<KaspaRocketChainOutcome> {
  const accepted = await Promise.all(
    txids.map(async (t) => {
      // KaspaRocket is mainnet only (Settings' restApis, not imported: it
      // pulls the Settings screen in).
      const r = await fetch(
        `https://api.kaspa.org/transactions/${encodeURIComponent(t)}`,
      );
      if (!r.ok) return false;
      return (await r.json())?.is_accepted === true;
    }),
  );
  return accepted.every(Boolean) ? "landed" : "unknown";
}

/** The plan on screen, with the quote and form it was built on. */
export type KaspaRocketPrepared = {
  quote: Quote;
  plan: TransactionPlan;
  /** keyOf(units) when it was built. */
  key: string;
  units: bigint;
  builtAt: number;
};

export type KaspaRocketConfirmInput = {
  storeKey: string;
  pairKey: string;
  prepared: KaspaRocketPrepared;
  /** What the form says now; a different key refuses. */
  liveKey: string;
  tokenId: string;
  lpCovenantId: string;
  side: "buy" | "sell";
  slippageBps: number;
  xOnlyPk: string;
  signDigest: (plan: TransactionPlan) => KaspaRocketSignDigest;
  submit: (
    signed: UnsignedTransaction[],
    plan: TransactionPlan,
  ) => Promise<unknown>;
  /** The record is written: the pair is pending from here. */
  onRecord?: () => void;
  now?: () => number;
};

export type KaspaRocketConfirmResult = {
  /** Whether the stored record still holds the pair. */
  pending: boolean;
  submitted?: true;
  message?: string;
  error?: unknown;
  rebuild?: true;
  requote?: true;
};

/**
 * One confirm, in this order: quote freshness → plan → guard refusals →
 * pending record → sign → submit. The record goes down on the first
 * signature request, which the signer makes only once every guard passed,
 * so a refusal leaves none and a popup that dies after submit leaves one.
 * Nothing here retries or resubmits.
 */
export async function confirmKaspaRocketSwap(
  c: KaspaRocketConfirmInput,
): Promise<KaspaRocketConfirmResult> {
  const now = c.now ?? Date.now;
  const { plan, quote, units, builtAt } = c.prepared;
  // 1. Quote freshness: the plan on screen, for the amount on screen.
  if (c.prepared.key !== c.liveKey)
    return { pending: false, message: KASPAROCKET_CHANGED_COPY };
  if (now() - builtAt > KASPAROCKET_PLAN_TTL_MS)
    return {
      pending: false,
      message: KASPAROCKET_PLAN_EXPIRED_COPY,
      rebuild: true,
    };
  // 2. The plan still within slippage of the quote it was built on.
  const bps = BigInt(c.slippageBps);
  if (kaspaRocketPriceMoved(plan, quote, c.side, bps))
    return { pending: false, message: PRICE_MOVED_COPY, requote: true };
  if (!(await claimKaspaRocketPair(c.storeKey)))
    return { pending: true, message: KASPAROCKET_PENDING_COPY };

  let written = false;
  let sent = false;
  try {
    const txids = kaspaRocketPlanTxids(plan);
    const sign = c.signDigest(plan);
    const signer = kastleKaspaRocketSigner(
      async (t, i) => {
        // 4. First signature request: every guard (3) has passed.
        if (!written) {
          await savePendingKaspaRocket(c.storeKey, {
            ref: kaspaRocketRef(plan, txids),
            pairKey: c.pairKey,
            txids,
            direction: c.side,
            amountIn: units,
            startedAt: now(),
          });
          written = true;
          c.onRecord?.();
        }
        // 5. Sign.
        return sign(t, i);
      },
      c.xOnlyPk,
      {
        quote,
        trade: { tokenId: c.tokenId, direction: c.side, amountIn: units },
        lpCovenantId: c.lpCovenantId,
        slippageBps: bps,
        builtAt,
        now,
      },
    );
    // 3–5. Guards, then record, then signatures.
    const signed = await signer.signPlan(plan);
    sent = true;
    // 6. Submit; its order and sponsor rows go back with the last tx.
    await c.submit(signed, plan);
    return { pending: true, submitted: true };
  } catch (e) {
    // ASSUMPTION carried from mobile: invalid_request from submit means no
    // transaction of the batch reached the network.
    const rejected =
      e instanceof KaspaRocketError && e.kind === "invalid_request";
    if (sent && !rejected)
      return { pending: true, message: KASPAROCKET_UNKNOWN_COPY, error: e };
    if (written)
      await clearPendingKaspaRocket(c.storeKey).catch(() => undefined);
    if (e instanceof KaspaRocketPlanExpired)
      return {
        pending: false,
        message: KASPAROCKET_PLAN_EXPIRED_COPY,
        error: e,
        rebuild: true,
      };
    const refused =
      e instanceof KaspaRocketSignRefusal ||
      e instanceof KaspaRocketTxFormatError;
    return {
      pending: false,
      error: e,
      requote: refused || rejected ? true : undefined,
      message: kaspaRocketErrorCopy(
        e,
        refused ? (e as Error).message : "Swap failed. Please try again.",
      ),
    };
  } finally {
    releaseKaspaRocketPair(c.storeKey);
  }
}

/** The plan's own figures; an unknown one drops its line, never shows 0. */
export function kaspaRocketFeeLines(
  plan: TransactionPlan | undefined,
  kasSompi: bigint | undefined,
  fees: KaspaRocketFees | undefined,
): FeeLine[] {
  const network = kaspaRocketNetworkFeeLine(plan);
  // protocol() only words the hint; the amount is the plan's.
  const hint = kaspaRocketFeeLine(kasSompi, fees)?.hint;
  const provider = kaspaRocketPlanFeeLine(plan, hint);
  return [...(network ? [network] : []), ...(provider ? [provider] : [])];
}

/** Balance first, then KaspaRocket's minimum; nothing while protocol() is unknown. */
export function kaspaRocketValidate(
  units: bigint,
  balanceIn: bigint | undefined,
  kasSompi: bigint | undefined,
  fees: KaspaRocketFees | undefined,
): string | undefined {
  if (units <= 0n) return undefined;
  if (balanceIn !== undefined && units > balanceIn)
    return NOT_ENOUGH_FUNDS_COPY;
  return kasSompi === undefined
    ? undefined
    : kaspaRocketMinOrderError(kasSompi, fees);
}
