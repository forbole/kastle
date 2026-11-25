// A KaspaRocket submit may reach the node even when its fetch dies with the
// popup. Mobile keeps the swap in a module-scope Map; the popup closes on
// blur and that Map with it, which would let a reopened popup swap the pair
// twice. So the swap is written to browser.storage.local BEFORE the submit,
// keyed per network, account and pair, and a reopened popup settles it from
// a chain check. Nothing here builds, signs, retries or submits.

export const KASPAROCKET_PENDING_PREFIX = "kasparocket_pending:";

/** network:address:pair, so another account or network never shares one. */
export const kaspaRocketPendingKey = (
  network: string,
  address: string,
  pairKey: string,
) => `${KASPAROCKET_PENDING_PREFIX}${network}:${address}:${pairKey}`;

/** What a reopened popup needs to tell whether the swap may have been sent. */
export type PendingKaspaRocketSwap = {
  /** kaspaRocketRef: the order id, else the last transaction's id. */
  ref: string;
  pairKey: string;
  /** Known before broadcast: a Kaspa txid excludes signature scripts. */
  txids: readonly string[];
  direction: "buy" | "sell";
  /** Buy: KAS sompi. Sell: raw token units. */
  amountIn: bigint;
  startedAt: number;
};

type Stored = Omit<PendingKaspaRocketSwap, "amountIn"> & { amountIn: string };

/**
 * The registry key: the order id when the plan placed one, else the last
 * transaction's id (a Kaspa txid excludes signature scripts, so it is known
 * before broadcast).
 */
export function kaspaRocketRef(
  plan: { order_row?: { order_id?: unknown } | null },
  txids: readonly string[],
): string {
  const orderId = plan.order_row?.order_id;
  return typeof orderId === "string" && orderId
    ? orderId
    : txids[txids.length - 1];
}

export async function loadPendingKaspaRocket(
  key: string,
): Promise<PendingKaspaRocketSwap | undefined> {
  const s = (await browser.storage.local.get(key))[key] as Stored | undefined;
  if (!s || !Array.isArray(s.txids) || typeof s.amountIn !== "string")
    return undefined;
  return { ...s, amountIn: BigInt(s.amountIn) };
}

/** Write before submit: from here on the swap may be on the wire. */
export const savePendingKaspaRocket = (
  key: string,
  swap: PendingKaspaRocketSwap,
) =>
  browser.storage.local.set({
    [key]: { ...swap, amountIn: swap.amountIn.toString() } satisfies Stored,
  });

export const clearPendingKaspaRocket = (key: string) =>
  browser.storage.local.remove(key);

/** Whether the chain shows `txids`: all accepted, none ever will be, or unsure. */
export type KaspaRocketChainOutcome = "landed" | "not-sent" | "unknown";

/**
 * Settles a stored swap, as a reopened popup does: landed or not-sent clears
 * it; unknown keeps it and answers "pending", and the pair stays blocked.
 * Never rebuilds, re-signs or resubmits from a stored record.
 */
export async function settlePendingKaspaRocket(
  key: string,
  check: (txids: readonly string[]) => Promise<KaspaRocketChainOutcome>,
): Promise<"landed" | "not-sent" | "pending" | undefined> {
  const swap = await loadPendingKaspaRocket(key);
  if (!swap) return undefined;
  let outcome: KaspaRocketChainOutcome;
  try {
    outcome = await check(swap.txids);
  } catch {
    outcome = "unknown";
  }
  if (outcome === "unknown") return "pending";
  await clearPendingKaspaRocket(key);
  return outcome;
}

// Pair key → a confirm between its pre-flight check and its submit. In memory
// on purpose: if the popup dies before the record is written, nothing was
// sent and the claim should die with it. Once written, the stored record
// holds the pair instead.
const claimed = new Set<string>();

/**
 * Reserves the pair for one confirm, until its record is written or it ends.
 * False while another confirm holds it or a stored swap on it is unsettled.
 */
export async function claimKaspaRocketPair(key: string): Promise<boolean> {
  if (claimed.has(key)) return false;
  claimed.add(key);
  if (await loadPendingKaspaRocket(key)) {
    claimed.delete(key);
    return false;
  }
  return true;
}

/** Ends a confirm; a stored record, if one was written, still holds the pair. */
export function releaseKaspaRocketPair(key: string): void {
  claimed.delete(key);
}
