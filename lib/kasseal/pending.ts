// Kasseal trades whose POST may have reached the node. Mobile keeps the
// attempt in memory; a popup dies on blur, and with it the pinned coins that
// stop a retry from funding a second trade. So each open attempt lives in
// browser.storage.local, written before its first POST (trade.ts persist)
// and cleared once the trade is known to have landed or to never land.
import {
  decodeKassealAttempt,
  encodeKassealAttempt,
  matchesKassealIntent,
  newKassealAttempt,
  settleKassealAttempt,
  submitKassealTrade,
  type KassealAttempt,
  type KassealIntent,
  type KassealSubmissionDeps,
  type StoredKassealAttempt,
} from "./trade";

// New prefix: legacy-cleanup.ts deletes "kasseal_attempts" on every boot.
// One storage key per trade, so no write ever reads another's record.
export const KASSEAL_PENDING_PREFIX = "kasseal_pending:";

/** Mobile's wording, as the confirm label and the refusal both show it. */
export const KASSEAL_PENDING_COPY =
  "A Kasseal swap on this pair is still settling. Check Activity.";

/** One trade per account and token on a network: the pair a pending blocks. */
export const kassealTradeKey = (
  network: string,
  address: string,
  covenantId: string,
) => `${KASSEAL_PENDING_PREFIX}${network}:${address}:${covenantId}`;

/** The open attempt for this trade, if a POST of it may have reached the node. */
export async function loadKassealAttempt(
  key: string,
): Promise<KassealAttempt | undefined> {
  const stored = (await browser.storage.local.get(key))[key] as
    | StoredKassealAttempt
    | undefined;
  return stored && decodeKassealAttempt(stored);
}

export const saveKassealAttempt = (key: string, attempt: KassealAttempt) =>
  browser.storage.local.set({ [key]: encodeKassealAttempt(attempt) });

export const clearKassealAttempt = (key: string) =>
  browser.storage.local.remove(key);

/**
 * Asks `/tx` about a stored attempt, as a reopened popup does; clears it once
 * it landed or cannot land. Never builds, signs or posts anything.
 */
export async function settlePendingKasseal(
  key: string,
  status: KassealSubmissionDeps["status"],
): Promise<"landed" | "not-sent" | "open" | undefined> {
  const attempt = await loadKassealAttempt(key);
  if (!attempt) return undefined;
  const outcome = await settleKassealAttempt(attempt, status);
  if (outcome !== "open") await clearKassealAttempt(key);
  return outcome;
}

/**
 * One press of Confirm that survives the popup: continues the stored attempt
 * for `key` (same pinned coins) or starts one, persisting it before every
 * POST. A stored attempt for another trade on the pair refuses: continuing it
 * would report its late success as this trade, and a fresh build would fund
 * a second one.
 */
export async function submitPersistedKassealTrade(
  deps: KassealSubmissionDeps,
  key: string,
  intent: KassealIntent,
): Promise<string> {
  const stored = await loadKassealAttempt(key);
  if (
    stored?.intent &&
    !matchesKassealIntent(
      stored.intent,
      intent.side,
      intent.venue,
      intent.amount,
    )
  )
    throw new Error(KASSEAL_PENDING_COPY);
  const attempt = stored ?? { ...newKassealAttempt(), intent };
  try {
    const txid = await submitKassealTrade(
      { ...deps, persist: (a) => saveKassealAttempt(key, a) },
      attempt,
    );
    await clearKassealAttempt(key);
    return txid;
  } catch (e) {
    // Nothing posted: nothing stored. Posted: keep it until /tx says it
    // landed or every POST was dropped.
    if (
      attempt.posted.length === 0 ||
      (await settleKassealAttempt(attempt, deps.status)) !== "open"
    )
      await clearKassealAttempt(key);
    throw e;
  }
}
