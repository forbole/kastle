// KCC-20 adapter: one kascov history row → the shared HistoryRecord.
import type { Kcc20HistoryRow } from "@/lib/kcc20/history";
import type { HistoryRecord } from "@/lib/history/types";

const NONE = { value: null, quality: "unavailable" } as const;

/**
 * kascov alone has no fee, fiat, KAS leg or finality, so those stay unavailable
 * and status unknown. Without decimals the amount stays in base units, unlabelled.
 */
export function toHistoryRecord(
  row: Kcc20HistoryRow,
  view: { symbol: string; decimals?: number },
  explorerBase?: string,
): HistoryRecord {
  return {
    id: row.id,
    family: "kcc20",
    txid: row.txid,
    kind: row.kind,
    direction: row.direction,
    amount:
      row.amount === undefined
        ? NONE
        : {
            value: {
              raw: row.amount.toString(),
              decimals: view.decimals ?? 0,
              symbol: view.decimals === undefined ? "" : view.symbol,
            },
            quality: "exact",
          },
    kasLeg: NONE,
    fiat: NONE,
    // Counted back from kascov's DAA tip; the shell never prints "≈" on a time.
    time: { value: row.timeMs, quality: "approximate" },
    counterparty: row.counterparty
      ? { value: row.counterparty, quality: "exact" }
      : NONE,
    fee: NONE,
    status: "unknown",
    explorer: explorerBase ? { url: `${explorerBase}${row.txid}` } : null,
  };
}
