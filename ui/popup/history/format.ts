// Pure display helpers for the shared history shell, kept free of React so a
// unit spec imports them directly.
import type {
  HistoryFamily,
  HistoryKind,
  HistoryRecord,
} from "@/lib/history/types";
import { formatHoldingUsd, textEllipsis } from "@/lib/utils";

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

/** The other side's label or shortened address; null for a self row or none. */
export function historyCounterpartyName(record: HistoryRecord): string | null {
  const { counterparty, direction } = record;
  if (
    direction === "self" ||
    counterparty.quality === "unavailable" ||
    !counterparty.value
  )
    return null;
  return counterparty.value.label ?? textEllipsis(counterparty.value.address);
}

const KEY_PREFIX = /^(presence|p2pkh):/;
const ADDRESS_PREFIX = /^(0x|kaspa:|kaspatest:|kaspadev:|kaspasim:)/i;

/**
 * "0x1f51…9497" / "kaspa:qr3x…k7x2": a known prefix kept, then the first
 * 4 and last 4 characters. Anything else is first 4 + "…" + last 4. An
 * address too short to lose anything is returned whole.
 */
export function shortAddress(address: string): string {
  // KCC-20 owners carry a "presence:" / "p2pkh:" tag; the key is what shows.
  const bare = address.replace(KEY_PREFIX, "");
  const prefix = ADDRESS_PREFIX.exec(bare)?.[0] ?? "";
  const body = bare.slice(prefix.length);
  if (body.length <= 4 + 4 + 3) return bare;
  return `${prefix}${body.slice(0, 4)}…${body.slice(-4)}`;
}

/**
 * The counterparty as the designed row title and sheet show it. A real label
 * ("KRON market", "#42 · …") stays; a missing label, or the old 8…5 ellipsis
 * the data layer fills in, is re-cut from the address by `shortAddress`.
 */
export function historyDesignedCounterparty(
  record: HistoryRecord,
): string | null {
  if (historyCounterpartyName(record) === null) return null;
  const value = record.counterparty.value!;
  const isDerived =
    value.label === textEllipsis(value.address) ||
    value.label === textEllipsis(value.address.replace(KEY_PREFIX, ""));
  if (!value.label || isDerived) return shortAddress(value.address);
  return value.label;
}

/** "To …" / "From …" the other side; a self row has none. */
export function historyCounterpartyText(record: HistoryRecord): string | null {
  const who = historyCounterpartyName(record);
  return who === null
    ? null
    : `${record.direction === "in" ? "From" : "To"} ${who}`;
}

/** A plain send / receive that names its counterparty; row title and sheet share it. */
export function historyNamesCounterparty(record: HistoryRecord): boolean {
  return (
    (record.kind === "send" || record.kind === "receive") &&
    historyCounterpartyName(record) !== null
  );
}

/**
 * Row title: "Sent to …" / "Received from …" for a plain send or receive with
 * a known counterparty; every other row keeps its own title.
 */
export function historyRowTitle(record: HistoryRecord): string {
  if (historyNamesCounterparty(record))
    return `${record.kind === "send" ? "Sent to" : "Received from"} ${historyDesignedCounterparty(record)}`;
  return historyTitle(record.kind, record.family);
}

/**
 * "12 Nov｜11:04" for the row's second line, the year only outside the current
 * one; null without a time. Same format as formatDateTime in
 * lib/activity/adapters.ts; keep in step.
 */
export function historyRowDateText(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}｜${time}`;
}

/** USD figure for the detail sheet's Value row; null when the source has none. */
export function historyFiatUsd(record: HistoryRecord): number | null {
  return record.fiat.quality === "unavailable"
    ? null
    : (record.fiat.value?.usd ?? null);
}

const FIAT_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** "≈ $19.235 USD" for the row's right column; null when the source has no fiat. */
export function historyFiatText(record: HistoryRecord): string | null {
  const usd = historyFiatUsd(record);
  if (usd === null) return null;
  const shown = FIAT_FORMAT.format(usd);
  // Only a non-zero value that 3 places collapse to "$0.000" takes the 8-dp
  // holding rule; anything 3 places already show (e.g. "$0.001") is unchanged.
  const text =
    usd !== 0 && !/[1-9]/.test(shown) ? formatHoldingUsd(usd) : shown;
  return `≈ ${text} USD`;
}

const STATUS_LABEL: Record<HistoryRecord["status"], string | null> = {
  finalized: "Finalized",
  pending: "Pending",
  failed: "Failed",
  unknown: null,
};

/** Display word for a record's status; null when the source cannot say. */
export function historyStatusLabel(
  status: HistoryRecord["status"],
): string | null {
  return STATUS_LABEL[status];
}
