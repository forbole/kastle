// Igra L2 credits for KAS → iKAS deposits (lib/bridge/igra-deposit-history.ts).
//
// L1 acceptance only proves the lane was PAID. Igra credits the destination at
// block level with no L2 transaction, and Blockscout records each credit as a
// beacon-chain withdrawal: /api/v2/addresses/{addr}/withdrawals has one item
// per credited deposit, `amount` in wei, sompi-exact (amount = sompi × 1e10).
// A deposit is only reported as delivered once its credit is found there.
//
// Matching: same destination, exact amount, and a credit timestamp within
// CREDIT_WINDOW_MS of the deposit's L1 acceptance, taking the closest one.
// Measured on the 40 newest mainnet lane deposits (2026-09-27): 39 matched,
// with the credit timestamp 467–550 s BEFORE L1 accepting_block_time (Igra's
// block clock runs behind; one outlier at +6 s). Deposits are matched
// oldest-first against a shared claimed set, so repeated amounts each take
// their own credit.

import { igraMainnet } from "@/lib/layer2";
import type { IgraDeposit } from "@/lib/bridge/igra-deposit-history";

/** What Igra's credit list says about one accepted deposit. */
export type IgraCreditObservation =
  /** The credit landed; its amount is the observed delivery. */
  | { status: "credited"; amountSompi: number; timeMs: number }
  /** List read, no credit yet, and the deposit is still inside the window. */
  | { status: "awaiting" }
  /** List read, the window has passed, and no credit matches. */
  | { status: "missing" };

export interface IgraCredit {
  amountSompi: number;
  timeMs: number;
  /** Blockscout's global withdrawal index — unique per credit. */
  index: string;
}

const WEI_PER_SOMPI = 10n ** 10n;
const CREDIT_WINDOW_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10_000;
// Blockscout pages are 50 items: 300 credits per destination. Re-paid every
// poll, and only when the wallet has accepted deposits.
const MAX_PAGES = 6;

/** Pure parse of one withdrawals page. Items that are not sompi-exact are skipped. */
export function parseIgraWithdrawals(payload: unknown): {
  credits: IgraCredit[];
  next: Record<string, unknown> | null;
} {
  const items = (payload as { items?: unknown })?.items;
  const credits: IgraCredit[] = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const { amount, timestamp, index } = (raw ?? {}) as Record<string, unknown>;
    if (typeof amount !== "string" || typeof timestamp !== "string") continue;
    let wei: bigint;
    try {
      wei = BigInt(amount);
    } catch {
      continue;
    }
    if (wei <= 0n || wei % WEI_PER_SOMPI !== 0n) continue;
    const timeMs = Date.parse(timestamp);
    if (!Number.isFinite(timeMs)) continue;
    credits.push({
      amountSompi: Number(wei / WEI_PER_SOMPI),
      timeMs,
      index: String(index ?? `${amount}:${timestamp}`),
    });
  }
  const next = (payload as { next_page_params?: unknown })?.next_page_params;
  return {
    credits,
    next:
      next && typeof next === "object"
        ? (next as Record<string, unknown>)
        : null,
  };
}

/**
 * Every credit to `evmAddress`, newest first. null = unreadable. `complete`
 * is false when MAX_PAGES ran out first: credits older than the last page's
 * are then unknown, not absent.
 */
export async function fetchIgraCredits(
  evmAddress: string,
): Promise<{ credits: IgraCredit[]; complete: boolean } | null> {
  const base = `${igraMainnet.apiUrl}/api/v2/addresses/${evmAddress}/withdrawals`;
  const credits: IgraCredit[] = [];
  let query = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(base + query, { signal: controller.signal });
      if (!res.ok) return null;
      const parsed = parseIgraWithdrawals(await res.json());
      credits.push(...parsed.credits);
      if (!parsed.next) return { credits, complete: true };
      query = `?${new URLSearchParams(
        Object.entries(parsed.next).map(([k, v]) => [k, String(v)]),
      )}`;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return { credits, complete: false };
}

/**
 * Pure matcher. Only accepted deposits are observed; the rest are returned
 * without an observation, as are deposits older than an incomplete list's
 * horizon (their credit may sit on a page that was not read).
 */
export function matchIgraCredits(
  deposits: IgraDeposit[],
  creditsByAddress: Map<
    string,
    { credits: IgraCredit[]; complete: boolean } | null
  >,
  nowMs: number,
): IgraDeposit[] {
  const claimed = new Set<string>();
  const observed = new Map<string, IgraCreditObservation>();
  const oldestFirst = [...deposits].sort(
    (a, b) => a.timestampMs - b.timestampMs,
  );
  for (const d of oldestFirst) {
    if (!d.accepted) continue;
    const list = creditsByAddress.get(d.evmAddress.toLowerCase());
    if (!list) continue;
    let best: IgraCredit | null = null;
    for (const c of list.credits) {
      if (claimed.has(c.index) || c.amountSompi !== d.amountSompi) continue;
      const gap = Math.abs(c.timeMs - d.timestampMs);
      if (gap > CREDIT_WINDOW_MS) continue;
      if (!best || gap < Math.abs(best.timeMs - d.timestampMs)) best = c;
    }
    if (best) {
      claimed.add(best.index);
      observed.set(d.txId, {
        status: "credited",
        amountSompi: best.amountSompi,
        timeMs: best.timeMs,
      });
      continue;
    }
    if (!list.complete) {
      const horizon = Math.min(...list.credits.map((c) => c.timeMs));
      if (d.timestampMs - CREDIT_WINDOW_MS < horizon) continue;
    }
    observed.set(d.txId, {
      status: nowMs - d.timestampMs < CREDIT_WINDOW_MS ? "awaiting" : "missing",
    });
  }
  return deposits.map((d) => {
    const credit = observed.get(d.txId);
    return credit ? { ...d, credit } : d;
  });
}

/** Attach Igra's credit observation to each deposit. Never throws. */
export async function attachIgraCredits(
  deposits: IgraDeposit[],
  fetchCredits = fetchIgraCredits,
): Promise<IgraDeposit[]> {
  const addresses = [
    ...new Set(
      deposits.filter((d) => d.accepted).map((d) => d.evmAddress.toLowerCase()),
    ),
  ];
  if (addresses.length === 0) return deposits;
  const lists = await Promise.all(
    addresses.map((a) => fetchCredits(a).catch(() => null)),
  );
  return matchIgraCredits(
    deposits,
    new Map(addresses.map((a, i) => [a, lists[i]])),
    Date.now(),
  );
}
