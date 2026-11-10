// Pure display helpers for the shared history shell, kept free of React so a
// unit spec imports them directly.
import type {
  HistoryFamily,
  HistoryKind,
  HistoryRecord,
} from "@/lib/history/types";
import { textEllipsis } from "@/lib/utils";

const TITLES: Record<HistoryKind, string> = {
  send: "Sent",
  receive: "Received",
  self: "Self transfer",
  buy: "Bought",
  sell: "Sold",
  mint: "Mint",
  deploy: "Contract deploy",
  unknown: "Transaction",
};

export function historyTitle(
  kind: HistoryKind,
  family?: HistoryFamily,
): string {
  // KCC-20 rows kascov could not attribute keep their own name.
  if (kind === "unknown" && family === "kcc20") return "Unattributed movement";
  return TITLES[kind] ?? TITLES.unknown;
}

/**
 * Integer string + decimals → "1,234.568": KCC-20's display (mobile's
 * formatNumber), 3 places rounded, built from the exact decimal string so no
 * float. A non-zero amount that would round to "0" shows its exact value.
 */
export function formatRawAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const value = BigInt(negative ? raw.slice(1) : raw);
  if (value === 0n) return "0";
  const padded = value.toString().padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const exact = fraction ? `${intPart}.${fraction}` : intPart;
  const shown = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(exact as Intl.StringNumericLiteral);
  return `${negative ? "-" : ""}${shown === "0" ? exact : shown}`;
}

/**
 * "+1,234.56 NACHO" / "−1,234.56 NACHO", or null when unavailable — the row
 * then renders nothing. A failed tx moved nothing, so it carries no sign.
 */
export function historyAmountText(record: HistoryRecord): string | null {
  const { amount, direction, status } = record;
  if (amount.quality === "unavailable" || !amount.value) return null;
  // A zero moved nothing either way, so it takes no sign.
  const sign =
    status === "failed" || BigInt(amount.value.raw) === 0n
      ? ""
      : direction === "in"
        ? "+"
        : direction === "out"
          ? "-"
          : "";
  const approx = amount.quality === "approximate" ? "≈ " : "";
  const symbol = amount.value.symbol ? ` ${amount.value.symbol}` : "";
  return `${approx}${sign}${formatRawAmount(amount.value.raw, amount.value.decimals)}${symbol}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** A date is exact: "≈" belongs to estimated fiat values, never to a timestamp. */
export function historyTimeText(ms: number | null): string | null {
  return ms === null ? null : DATE_FORMAT.format(new Date(ms));
}

/** "To …" / "From …" the other side; a self row has none. */
export function historyCounterpartyText(record: HistoryRecord): string | null {
  const { counterparty, direction } = record;
  if (
    direction === "self" ||
    counterparty.quality === "unavailable" ||
    !counterparty.value
  )
    return null;
  const who =
    counterparty.value.label ?? textEllipsis(counterparty.value.address);
  return `${direction === "in" ? "From" : "To"} ${who}`;
}

/** USD figure for the detail sheet's Value row; null when the source has none. */
export function historyFiatUsd(record: HistoryRecord): number | null {
  return record.fiat.quality === "unavailable"
    ? null
    : (record.fiat.value?.usd ?? null);
}
