// Pure display helpers for the shared history shell, kept free of React so a
// unit spec imports them directly.
import type {
  HistoryFamily,
  HistoryKind,
  HistoryRecord,
} from "@/lib/history/types";
import { textEllipsis } from "@/lib/utils";

/** Display precision for a token amount; extra digits are truncated, not rounded. */
const MAX_FRACTION_DIGITS = 8;

/** Smallest amount the display shows; anything non-zero below it reads "<" this. */
const DISPLAY_FLOOR = `0.${"1".padStart(MAX_FRACTION_DIGITS, "0")}`;

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
 * Integer string + decimals → "1,234.5678", all bigint, no float. A non-zero
 * amount that truncates to nothing reads "<0.00000001", never "0".
 */
export function formatRawAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const value = BigInt(negative ? raw.slice(1) : raw);
  const padded = value.toString().padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals) || "0";
  const fraction = padded
    .slice(padded.length - decimals)
    .slice(0, MAX_FRACTION_DIGITS)
    .replace(/0+$/, "");
  const grouped = BigInt(intPart).toLocaleString("en-US");
  if (value !== 0n && grouped === "0" && !fraction)
    return `${negative ? "-" : ""}<${DISPLAY_FLOOR}`;
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/**
 * "+1,234.56 NACHO" / "−1,234.56 NACHO", or null when unavailable — the row
 * then renders nothing. A failed tx moved nothing, so it carries no sign.
 */
export function historyAmountText(record: HistoryRecord): string | null {
  const { amount, direction, status } = record;
  if (amount.quality === "unavailable" || !amount.value) return null;
  const sign =
    status === "failed"
      ? ""
      : direction === "in"
        ? "+"
        : direction === "out"
          ? "−"
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
