import kaspaIcon from "@/assets/images/network-logos/kaspa.svg";
import katLogo from "@/assets/images/providers/kat-logo.png";
import {
  ActivityAmount,
  ActivityRowDescriptor,
  ActivityStatusToken,
} from "@/lib/activity/types";
import { formatCurrency } from "@/lib/utils";
import {
  IGRA_DEPOSIT_ACTIVITY_TYPE,
  KURVE_BRIDGE_ACTIVITY_TYPE,
  SWAP_ACTIVITY_TYPE,
  trimDecimal,
} from "@/lib/activity/mappers";
import { swapVenueName, toProviderId } from "@/lib/activity/swap-history";
import { ALL_SWAP_PROVIDERS } from "@/lib/evm/swap/constants";
import { igraMainnet, kasplexMainnet } from "@/lib/layer2";

// Ported from kastle-mobile lib/activity/adapters.tsx: descriptor → display
// item. Mobile hands the item to its ported kastle-ui components; here it is
// plain data (image URLs, link URLs) the Activity screen renders directly.
// Dropped with the local exit log (see hooks/useActivityFeed.ts): the
// bridge_exit type, refund rows and the exit-only "expected payout" line.

const SWAP_PROVIDER_BY_ID = new Map(
  ALL_SWAP_PROVIDERS.map((p) => [toProviderId(p.name), p]),
);

export type PillStatus = "success" | "failed" | "pending";

const STATUS_PILL: Partial<Record<ActivityStatusToken, PillStatus>> = {
  completed: "success",
  failed: "failed",
  submitted: "pending",
  pending: "pending",
  acknowledged: "pending",
  refund_claimable: "pending",
};

const STATUS_LABEL: Record<ActivityStatusToken, string> = {
  completed: "Completed",
  failed: "Failed",
  submitted: "Submitted",
  pending: "Pending",
  refund_claimable: "Refund available",
  acknowledged: "Acknowledged",
  eligibility_unknown: "Unknown",
  unknown: "Unknown",
};

export interface DetailRow {
  label: string;
  value: string;
  pill?: PillStatus;
  icon?: string;
  url?: string;
  subtext?: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  dateTime: string;
  fromImage?: string;
  toImage?: string;
  chainImage: string;
  amountNumber: string;
  amountSymbol?: string;
  amountUsd: string;
  tone: "credit" | "neutral";
  isInProgress: boolean;
  sheet: {
    title: string;
    subtitle: string;
    transfer: {
      fromSymbol: string;
      toSymbol: string;
      fromImage?: string;
      toImage?: string;
      fromChainImage: string;
      toChainImage: string;
      sentLabel: string;
      sentAmount: string;
      sentUsd: string;
      receivedLabel: string;
      receivedAmount?: string;
      receivedUsd?: string;
    };
    details: DetailRow[];
  };
}

export interface AdapterDeps {
  logoFor: (symbol: string) => string | undefined;
  priceFor: (symbol: string) => number | undefined;
}

export function formatDateTime(timestampMs: number): string {
  const d = new Date(timestampMs);
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

const isBridgeRow = (row: ActivityRowDescriptor) =>
  row.type !== SWAP_ACTIVITY_TYPE;
const isInProgress = (row: ActivityRowDescriptor) =>
  row.status === "pending" || row.status === "submitted";

// The list row's title must never read "Swapped"/"Bridged" when the status
// is not — same failure/refund signal the detail sheet's Status row uses.
function rowTitle(row: ActivityRowDescriptor): string {
  if (row.status === "failed") return "Failed";
  if (row.status === "refund_claimable") return "Refunded";
  if (!isBridgeRow(row)) return isInProgress(row) ? "Swapping" : "Swapped";
  return isInProgress(row) ? "Bridging" : "Bridged";
}

function sheetTitle(row: ActivityRowDescriptor): string {
  if (row.type === SWAP_ACTIVITY_TYPE) {
    return row.sent?.symbol && row.received?.symbol
      ? `Swap ${row.sent.symbol} → ${row.received.symbol}`
      : "Swap";
  }
  if (row.type === KURVE_BRIDGE_ACTIVITY_TYPE) {
    return row.meta?.route === "l1-to-l2"
      ? "Bridge KAS (Kaspa → Kasplex)"
      : "Bridge KAS (Kasplex → Kaspa)";
  }
  if (row.type === IGRA_DEPOSIT_ACTIVITY_TYPE) {
    return "Bridge KAS (Kaspa → Igra)";
  }
  // KAT transfer: runs both directions on both L2s; the mapper names the L2.
  const l2 = row.meta?.l2Chain ?? "Igra";
  const asset = row.sent?.symbol ?? "";
  const dir =
    row.meta?.route === "l1-to-l2" ? `Kaspa → ${l2}` : `${l2} → Kaspa`;
  return asset ? `Bridge ${asset} (${dir})` : `Bridge (${dir})`;
}

/** Dashboard parity with mobile's formatNumber: at most 3 fraction digits. */
function fmtAmount(value: string): string {
  if (!value) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const capped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(n);
  // A true non-zero amount under 0.001 (e.g. 0.0003 KAS) rounds to a false
  // "0" at 3dp — fall back to the full-precision trim instead.
  return n !== 0 && Number(capped) === 0 ? trimDecimal(n) : capped;
}

/** "<num> <SYM>" fee strings: cap like amounts, but never print a false 0. */
function fmtFee(fee: string): string {
  const [num, ...rest] = fee.split(" ");
  const n = Number(num);
  const capped = fmtAmount(num);
  const shown = n !== 0 && Number(capped) === 0 ? trimDecimal(n) : capped;
  return [shown, ...rest].join(" ").trim();
}

/** Blank symbols (mappers pass "" through) become undefined. */
function symbolText(symbol: string | undefined): string | undefined {
  const s = symbol?.trim();
  return s ? s : undefined;
}

function amountText(amount: ActivityAmount | undefined): string | undefined {
  if (!amount) return undefined;
  const sym = symbolText(amount.symbol);
  return sym ? `${fmtAmount(amount.value)} ${sym}` : fmtAmount(amount.value);
}

function usdText(
  amount: ActivityAmount | undefined,
  priceFor: AdapterDeps["priceFor"],
): string {
  if (!amount) return "";
  const price = priceFor(amount.symbol);
  const value = Number(amount.value);
  if (!price || !Number.isFinite(value)) return "";
  const usd = value * price;
  // A real value that still rounds to $0.00 is worse than no line at all.
  if (usd < 0.005) return "";
  return `≈ ${formatCurrency(usd)} USD`;
}

function rateText(row: ActivityRowDescriptor): string | null {
  const from = symbolText(row.sent?.symbol);
  const to = symbolText(row.received?.symbol);
  if (!from || !to) return null;
  const sent = Number(row.sent!.value);
  const received = Number(row.received!.value);
  if (!(sent > 0) || !(received > 0)) return null;
  const rate = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(received / sent);
  return `1 ${from} ≈ ${rate} ${to}`;
}

function feeRows(row: ActivityRowDescriptor): DetailRow[] {
  const rows: DetailRow[] = [
    {
      // Swap meta.fee is the gas the tx paid; bridge meta.fee is the
      // bridge/provider fee (mappers.ts), so it is not a network fee.
      label: isBridgeRow(row) ? "Provider fee" : "Network fee",
      value: row.meta?.fee ? fmtFee(row.meta.fee) : "-",
    },
  ];
  // Observed → amount; charged but unreadable → "-"; not charged → no row.
  if (row.meta?.kastleFee) {
    rows.push({ label: "Kastle fee", value: fmtFee(row.meta.kastleFee) });
  } else if (row.meta?.kastleFeeUnobserved) {
    rows.push({ label: "Kastle fee", value: "-" });
  }
  return rows;
}

const linkRow = (label: string, url: string | undefined): DetailRow =>
  url ? { label, value: "View", url } : { label, value: "-" };

function buildDetails(row: ActivityRowDescriptor): DetailRow[] {
  const bridge = isBridgeRow(row);
  const kurve = row.type === KURVE_BRIDGE_ACTIVITY_TYPE;
  const igraDeposit = row.type === IGRA_DEPOSIT_ACTIVITY_TYPE;
  // Igra exits reach this feed as KAT rows (see useActivityFeed.ts) running
  // L2 → Kaspa — not Kurve (its own both-directions type) and not an Igra
  // deposit (always Kaspa → Igra). Route defaults to exit, same as sheetTitle.
  const isExit =
    bridge && !kurve && !igraDeposit && row.meta?.route !== "l1-to-l2";
  const details: DetailRow[] = [
    {
      label: "Status",
      value: STATUS_LABEL[row.status],
      pill: STATUS_PILL[row.status],
      ...(isExit && isInProgress(row)
        ? { subtext: "Usually done within 48 hours" }
        : {}),
    },
    ...feeRows(row),
  ];

  if (!bridge) {
    details.push({ label: "Rate", value: rateText(row) ?? "-" });
    if (row.meta?.slippage) {
      details.push({ label: "Slippage", value: row.meta.slippage });
    }
    // History-only venues (e.g. Launchpad) are missing from
    // ALL_SWAP_PROVIDERS; swapVenueName still names them, without a logo.
    const provider = row.meta?.providerId
      ? SWAP_PROVIDER_BY_ID.get(row.meta.providerId)
      : undefined;
    const providerName =
      provider?.name ??
      (row.meta?.providerId ? swapVenueName(row.meta.providerId) : null);
    if (providerName) {
      details.push({
        label: "Provider",
        value: providerName,
        icon: provider?.image,
      });
    }
    // Mobile opened every swap on the Igra explorer; a Kasplex swap belongs on
    // Kasplex's.
    const explorer = (
      row.meta?.l2Chain === "Kasplex" ? kasplexMainnet : igraMainnet
    ).blockExplorers.default.url;
    const txHash = row.meta?.txHash;
    details.push(
      linkRow("Transaction", txHash ? `${explorer}/tx/${txHash}` : undefined),
    );
    return details;
  }

  details.push({
    label: "Provider",
    value: kurve
      ? "Kasplex Bridge"
      : igraDeposit
        ? "IGRA Bridge"
        : "KAT Bridge",
    icon: kurve
      ? kasplexMainnet.icon
      : igraDeposit
        ? igraMainnet.icon
        : katLogo,
  });
  // Every bridge row spans a chain pair it decides itself, so its mapper
  // supplies full explorer URLs.
  details.push(linkRow("Source TX", row.meta?.sourceTxUrl));
  details.push(linkRow("Destination TX", row.meta?.destinationTxUrl));
  return details;
}

export function toActivityItem(
  row: ActivityRowDescriptor,
  deps: AdapterDeps,
): ActivityItem {
  const dateTime = formatDateTime(row.timestampMs);
  const bridge = isBridgeRow(row);
  const swap = !bridge;
  const inProgress = bridge && isInProgress(row);
  const settled = row.status === "completed";
  const l2Logo =
    row.type === KURVE_BRIDGE_ACTIVITY_TYPE || row.meta?.l2Chain === "Kasplex"
      ? kasplexMainnet.icon
      : igraMainnet.icon;
  const intoL2 = row.meta?.route === "l1-to-l2";
  const fromAsset = symbolText(row.sent?.symbol);
  const toAsset = symbolText(row.received?.symbol);
  const fromImage = fromAsset ? deps.logoFor(fromAsset) : undefined;
  const toImage = toAsset ? deps.logoFor(toAsset) : undefined;

  // A SETTLED bridge reports what was DELIVERED — never fall back to the gross
  // sent amount there (mobile shipped that bug once). Any other bridge
  // (pending, failed, unknown) reports what was SENT: its received leg is at
  // most an expectation, and showing it would present a credit that has not
  // landed. Swaps keep the fallback: one chain, no fee legs between the two
  // amounts.
  const amountLeg = bridge
    ? settled
      ? row.received
      : row.sent
    : (row.received ?? row.sent);
  const swapCredit = swap && !!row.received && row.status !== "failed";
  // Only a delivered amount is a credit; an outlay is never signed "+".
  const signed = !!amountLeg && (bridge ? settled : swapCredit);

  return {
    id: row.id,
    title: rowTitle(row),
    dateTime,
    fromImage,
    toImage,
    chainImage: l2Logo,
    amountNumber: amountLeg
      ? `${signed ? "+" : ""}${fmtAmount(amountLeg.value)}`
      : "-",
    amountSymbol: amountLeg ? symbolText(amountLeg.symbol) : undefined,
    amountUsd: usdText(amountLeg, deps.priceFor),
    tone: signed && !inProgress ? "credit" : "neutral",
    isInProgress: inProgress,
    sheet: {
      title: sheetTitle(row),
      subtitle: dateTime,
      transfer: {
        fromSymbol: fromAsset ?? "-",
        toSymbol: toAsset ?? "-",
        fromImage,
        toImage,
        // A swap stays on one chain; a bridge is L1 on one side.
        fromChainImage: swap ? l2Logo : intoL2 ? kaspaIcon : l2Logo,
        toChainImage: swap ? l2Logo : intoL2 ? l2Logo : kaspaIcon,
        sentLabel: swap ? "Paid" : "Sent",
        sentAmount: amountText(row.sent) ?? "-",
        sentUsd: usdText(row.sent, deps.priceFor),
        receivedLabel:
          row.received && ((bridge && !settled) || (swap && isInProgress(row)))
            ? "You'll receive"
            : "Received",
        // No received leg: omit the line, except on a settled bridge, where a
        // missing line would read as a broken sheet.
        ...(row.received
          ? {
              receivedAmount: amountText(row.received),
              receivedUsd: usdText(row.received, deps.priceFor),
            }
          : bridge && settled
            ? { receivedAmount: "Amount unavailable" }
            : {}),
      },
      details: buildDetails(row),
    },
  };
}
