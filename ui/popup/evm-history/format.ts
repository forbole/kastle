// Pure display helpers for EvmHistoryRow, kept free of React so the unit spec
// imports them directly.
import type { HistoryKind, HistoryRecord } from "@/lib/history/types";

/** Display precision for a token amount; extra digits are truncated, not rounded. */
const MAX_FRACTION_DIGITS = 8;

const TITLES: Record<HistoryKind, string> = {
  send: "Sent",
  receive: "Received",
  self: "Self transfer",
  deploy: "Contract deploy",
  mint: "Mint",
  buy: "Bought",
  sell: "Sold",
  unknown: "Transaction",
};

export function historyTitle(kind: HistoryKind): string {
  return TITLES[kind] ?? TITLES.unknown;
}

/** Integer string + decimals → "1,234.5678", all bigint, no float. */
export function formatRawAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const digits = BigInt(negative ? raw.slice(1) : raw).toString();
  const padded = digits.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals) || "0";
  const fraction = padded
    .slice(padded.length - decimals)
    .slice(0, MAX_FRACTION_DIGITS)
    .replace(/0+$/, "");
  const grouped = BigInt(intPart).toLocaleString("en-US");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/**
 * The signed amount line ("+1.5 USDC" / "−1.5 USDC"), or null when the amount
 * is unavailable — the row then renders nothing, never a dash.
 */
export function historyAmountText(record: HistoryRecord): string | null {
  const { amount, direction } = record;
  if (amount.quality === "unavailable" || !amount.value) return null;
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const approx = amount.quality === "approximate" ? "≈ " : "";
  const symbol = amount.value.symbol ? ` ${amount.value.symbol}` : "";
  return `${approx}${sign}${formatRawAmount(amount.value.raw, amount.value.decimals)}${symbol}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Same format as the KRC-20 history row; "≈" when the time is not exact. */
export function historyTimeText(time: HistoryRecord["time"]): string | null {
  if (time.quality === "unavailable" || time.value === null) return null;
  const text = DATE_FORMAT.format(new Date(time.value));
  return time.quality === "exact" ? text : `≈ ${text}`;
}

/** "Nov 10, 2026, 3:04 PM · 0x12…ab": time, then counterparty, when present. */
export function historySubLine(record: HistoryRecord): string {
  const parts = [historyTimeText(record.time)];
  if (record.counterparty.quality !== "unavailable") {
    const party = record.counterparty.value;
    parts.push(party?.label ?? party?.address ?? null);
  }
  return parts.filter(Boolean).join(" · ");
}

/** Only pending and failed earn a badge; finalized is the normal case. */
export function historyStatusBadge(
  status: HistoryRecord["status"],
): "Pending" | "Failed" | null {
  if (status === "pending") return "Pending";
  if (status === "failed") return "Failed";
  return null;
}
