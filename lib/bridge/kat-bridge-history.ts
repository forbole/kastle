// KAT bridge history — GET /bridge-history (api.katbridge.com).
// Docs: kaspakat.gitbook.io/kat-bridge/developer-integration/rest-api.
//
// The authoritative, wallet-scoped record of every KAT-operated route
// (KAS ↔ iKAS and KRC-20, on both Igra and Kasplex). Being remote and
// wallet-scoped, it survives reinstall and seed import — unlike
// lib/bridge/exit-history.ts, which is local AsyncStorage only.
//
// TWO QUERIES ARE MANDATORY, not an optimisation:
//   ?fromL1Wallet=<kaspa address> → DEPOSIT rows only
//   ?fromL2Wallet=<evm address>   → WITHDRAW rows only
// Passing both in one call returns HTTP 200 with {"success":false,"data":null}
// (verified live 2026-08-20). Querying only the EVM address — which is what a
// naive port of the exit-only path would do — is exactly why deposits were
// missing from the feed.
//
// Kurve (Kaspa ↔ Kasplex) is a different mechanism on /kurve-bridge and never
// appears here: the originTxHash set of one is disjoint from the l1TxId/l2TxHash
// set of the other (verified live), so no cross-source dedupe is required.

import {
  KAT_BRIDGE_API,
  requestJson,
  unwrapRegistryRows,
} from "@/lib/bridge/kat-registry";
import {
  attachKatObservedFees,
  type KatObservedFees,
} from "@/lib/bridge/kat-observed-fees";

/** Kaspa L1's id in KAT's chain table for this endpoint (0 elsewhere — see kat-registry). */
export const KAT_L1_CHAIN_ID = 1;

export type KatBridgeDirection = "DEPOSIT" | "WITHDRAW";

/** The only status values the endpoint exposes; the docs' stage ladders are conceptual. */
export type KatBridgeStatus = "PENDING" | "COMPLETED" | "FAILED";

/** One /bridge-history row. Field names verbatim from the API. */
export interface KatBridgeTx {
  id: string;
  direction: KatBridgeDirection;
  /** KAT_L1_CHAIN_ID on deposits; the L2 chain id on withdrawals. */
  fromChainId: number;
  toChainId: number;
  fromWallet: string;
  /** EVM casing is inconsistent between routes — compare case-folded. */
  toWallet: string;
  tokenContract: string;
  tokenTick: string;
  /** Decimal DISPLAY units — not wei, not sompi. No decimals table needed. */
  amount: string;
  status: KatBridgeStatus;
  l1TxId: string | null;
  /** null on Igra deposits even when COMPLETED — never a valid dedupe key. */
  l2TxHash: string | null;
  completedAt: string | null;
  createdAt: string;
  /**
   * Fees read from chain by lib/bridge/kat-observed-fees.ts — NOT part of the
   * API row, which carries no fee field at all. Absent whenever the read
   * failed or the row fell past the observation cap; never a placeholder.
   */
  observedFees?: KatObservedFees;
}

/**
 * Which half of the history is missing or truncated. Never silent: the feed
 * must say so. `_unavailable` means that side could not be read at all;
 * `_partial` means it read fine but stopped at MAX_PAGES with more rows left
 * on the server — a present-but-incomplete list, never conflated with a
 * failure.
 */
export type BridgeHistoryDegradation =
  | "bridge_history_deposits_unavailable"
  | "bridge_history_exits_unavailable"
  | "bridge_history_unavailable"
  | "bridge_history_deposits_partial"
  | "bridge_history_exits_partial"
  | "bridge_history_partial";

const PAGE_SIZE = 100; // endpoint maximum; 101 is a 400
// Cost ceiling, not a coverage guarantee: 400 rows/side is far past any real
// wallet observed (busiest test wallet: 14 total). This lane has no cache —
// unlike lib/bridge/igra-deposit-history.ts — so it re-pays this cost every
// 10s poll; raise it only alongside a cache, not on its own. A page here is
// ~55-60 KB (measured live, 3,666 bytes / 6 rows), nowhere near Igra's
// 210-390 KB/page, so 4 pages costs little even paid every poll.
const MAX_PAGES = 4;

function isBridgeTx(row: unknown): row is KatBridgeTx {
  const r = row as KatBridgeTx;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.id === "string" &&
    (r.direction === "DEPOSIT" || r.direction === "WITHDRAW") &&
    typeof r.amount === "string" &&
    typeof r.tokenTick === "string" &&
    typeof r.createdAt === "string"
  );
}

/** Addresses already warned about, so the log records a horizon, not a poll. */
const warnedTruncated = new Set<string>();

/** Test seam — a fresh process starts empty, so only tests need this. */
export function clearKatBridgeHistoryWarnings(): void {
  warnedTruncated.clear();
}

/**
 * One wallet side, paginated. `ok: false` means the API could not be read —
 * distinct from a genuine empty history, which is `ok: true` with no rows.
 * `truncated` is only meaningful when `ok`: true means MAX_PAGES ran out
 * while the server's own `hasMore` still said yes, so `txs` is the newest
 * slice of this side rather than all of it.
 */
async function fetchWalletSide(
  param: "fromL1Wallet" | "fromL2Wallet",
  wallet: string,
): Promise<{ txs: KatBridgeTx[]; ok: boolean; truncated: boolean }> {
  const txs: KatBridgeTx[] = [];
  let total: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await requestJson(
      `${KAT_BRIDGE_API}/bridge-history?${param}=${encodeURIComponent(wallet)}` +
        `&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    );
    if (payload === null) return { txs, ok: false, truncated: false };
    // {"success":false,"data":null} is a 200 — a null envelope is a failure,
    // not an empty history.
    const data = (payload as { data?: unknown }).data;
    if (!data) return { txs, ok: false, truncated: false };

    txs.push(...unwrapRegistryRows(payload).filter(isBridgeTx));

    const pagination = (
      data as { pagination?: { hasMore?: boolean; total?: number } }
    ).pagination;
    if (typeof pagination?.total === "number") total = pagination.total;
    // Trust the server's own hasMore, not a length guess — unlike
    // api.kaspa.org (lib/bridge/igra-deposit-history.ts), this endpoint is a
    // purpose-built paginated contract, not a raw indexer that de-dupes
    // within a page and produces short pages mid-history.
    if (!pagination?.hasMore) return { txs, ok: true, truncated: false };
  }

  // Ran out of pages with the server still saying more exist. MAX_PAGES is a
  // cost ceiling, not a coverage guarantee — see the comment there.
  const key = `${param}:${wallet}`;
  if (!warnedTruncated.has(key)) {
    warnedTruncated.add(key);
    console.warn(
      `[kat-bridge-history] ${param} truncated at ${MAX_PAGES * PAGE_SIZE} rows` +
        (total !== null ? ` (server reports ${total} total)` : ""),
    );
  }
  return { txs, ok: true, truncated: true };
}

/**
 * Full KAT history for an account: deposits from the Kaspa address, exits from
 * the EVM address. A missing address is "nothing to ask", never a degradation.
 * Never throws.
 */
export async function fetchKatBridgeHistory({
  kaspaAddress,
  evmAddress,
}: {
  kaspaAddress?: string | null;
  evmAddress?: string | null;
}): Promise<{ txs: KatBridgeTx[]; degraded: BridgeHistoryDegradation | null }> {
  const [deposits, exits] = await Promise.all([
    kaspaAddress ? fetchWalletSide("fromL1Wallet", kaspaAddress) : null,
    evmAddress ? fetchWalletSide("fromL2Wallet", evmAddress) : null,
  ]);

  const depositsFailed = deposits !== null && !deposits.ok;
  const exitsFailed = exits !== null && !exits.ok;
  // A failed side and a truncated side are different states — unavailable
  // wins when both apply to a side, which they can't: fetchWalletSide never
  // reports truncated on a failed read.
  const depositsTruncated = deposits !== null && deposits.ok && deposits.truncated;
  const exitsTruncated = exits !== null && exits.ok && exits.truncated;
  const degraded: BridgeHistoryDegradation | null =
    depositsFailed && exitsFailed
      ? "bridge_history_unavailable"
      : depositsFailed
        ? "bridge_history_deposits_unavailable"
        : exitsFailed
          ? "bridge_history_exits_unavailable"
          : depositsTruncated && exitsTruncated
            ? "bridge_history_partial"
            : depositsTruncated
              ? "bridge_history_deposits_partial"
              : exitsTruncated
                ? "bridge_history_exits_partial"
                : null;

  // The two sides are disjoint by construction, but id is the only universally
  // present identifier (l2TxHash is null on Igra deposits) — dedupe on it.
  const byId = new Map<string, KatBridgeTx>();
  for (const tx of [...(deposits?.txs ?? []), ...(exits?.txs ?? [])]) {
    byId.set(tx.id, tx);
  }
  // Fees are not in the API response — they are on chain, and this is the only
  // place that holds both txids and the network budget to go get them. Never
  // affects `degraded`: an unread fee dashes one row, it does not make the
  // history incomplete.
  const txs = await attachKatObservedFees([...byId.values()]);
  return { txs, degraded };
}
