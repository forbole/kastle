// The shared per-asset History record. Every family adapter maps its own
// source into this shape; the shell (components/assets/history) renders it.
// Sits alongside lib/activity/types.ts, which stays the Activity feed's own.

/**
 * How much a field can be trusted. "approximate" renders with a "≈" prefix;
 * "unavailable" renders nothing — never a dash or a guessed number.
 */
export type Quality = "exact" | "approximate" | "unavailable";

export type Q<T> = { value: T | null; quality: Quality };

export type HistoryFamily =
  | "kas"
  | "krc20"
  | "krc721"
  | "kcc20"
  | "kns"
  | "dotk"
  | "evm-native"
  | "erc20"
  | "erc721";

export type HistoryKind =
  | "send"
  | "receive"
  | "self"
  | "buy"
  | "sell"
  | "mint"
  | "deploy"
  | "unknown";

export type HistoryDirection = "in" | "out" | "self";

export type HistoryStatus = "finalized" | "pending" | "failed" | "unknown";

export interface HistoryRecord {
  id: string;
  family: HistoryFamily;
  txid: string | null;
  kind: HistoryKind;
  direction: HistoryDirection;
  /** Integer units as a string; `decimals` places the point. */
  amount: Q<{ raw: string; decimals: number; symbol: string }>;
  /** The KAS that moved alongside a token leg (a buy's cost, a sell's proceeds). */
  kasLeg: Q<{ sompi: string }>;
  fiat: Q<{ usd: number }>;
  /** Epoch milliseconds. */
  time: Q<number>;
  counterparty: Q<{ address: string; label?: string }>;
  /** Integer units as a string, in the fee's own symbol. */
  fee: Q<{ raw: string; symbol: string }>;
  status: HistoryStatus;
  explorer: { url: string } | null;
}
