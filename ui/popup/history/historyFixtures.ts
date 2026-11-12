// Shared sample data for the history stories (not a story file).
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import type { HistoryRecord } from "@/lib/history/types";
import { historyFiatText } from "@/ui/popup/history/format";

export const NOW = Date.UTC(2026, 10, 10, 11, 51);
const ADDRESS =
  "kaspa:qpamkvhgh0kzx50gwvvp5xs8ktmqutcy3dfs9dc3w7lm9rq0zs76vf959mmrp";
const TXID = "9f1c2b7e4d3a5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";

function record(overrides: Partial<HistoryRecord> & { id: string }) {
  return {
    family: "kcc20",
    txid: TXID,
    kind: "receive",
    direction: "in",
    amount: {
      value: { raw: "123456000000", decimals: 8, symbol: "NACHO" },
      quality: "exact",
    },
    kasLeg: { value: null, quality: "unavailable" },
    fiat: { value: null, quality: "unavailable" },
    time: { value: NOW, quality: "exact" },
    counterparty: { value: { address: ADDRESS }, quality: "exact" },
    fee: { value: null, quality: "unavailable" },
    status: "finalized",
    explorer: { url: `https://kaspa.stream/transactions/${TXID}` },
    ...overrides,
  } satisfies HistoryRecord;
}

export const RECORDS: HistoryRecord[] = [
  record({ id: "in" }),
  record({
    id: "out",
    kind: "send",
    direction: "out",
    counterparty: {
      value: { address: ADDRESS, label: "alice.kas" },
      quality: "exact",
    },
    time: { value: NOW - 3_600_000, quality: "exact" },
  }),
  record({
    id: "self",
    kind: "self",
    direction: "self",
    time: { value: NOW - 7_200_000, quality: "exact" },
  }),
  record({
    id: "unknown",
    kind: "unknown",
    direction: "in",
    status: "unknown",
    amount: {
      value: { raw: "50000000", decimals: 8, symbol: "NACHO" },
      quality: "approximate",
    },
    explorer: null,
  }),
  record({ id: "pending", status: "pending" }),
  record({
    id: "failed",
    kind: "send",
    direction: "out",
    status: "failed",
  }),
  record({
    id: "no-amount",
    kind: "buy",
    amount: { value: null, quality: "unavailable" },
    counterparty: { value: null, quality: "unavailable" },
  }),
  record({
    id: "no-time",
    kind: "sell",
    direction: "out",
    time: { value: null, quality: "unavailable" },
    txid: null,
  }),
];

function token(
  id: string,
  family: HistoryRecord["family"],
  kind: HistoryRecord["kind"],
  raw: string,
  usd: number,
) {
  return record({
    id,
    family,
    kind,
    direction: kind === "send" ? "out" : "in",
    amount: { value: { raw, decimals: 8, symbol: "TTTT" }, quality: "exact" },
    fiat: { value: { usd }, quality: "approximate" },
  });
}

// Token-page rows: logo + chain badge, symbol-less amounts, fiat, TX count.
export const COMMON_EXTRAS = {
  chainBadge: kasIcon,
  txCount: 2,
  isSymbolHidden: true,
};

// Only KRC-20 has Committed / Revealed; every other family passes no steps and
// the card shows the record's own status with the explorer link.
export const KRC20_EXTRAS = {
  ...COMMON_EXTRAS,
  hashSteps: [
    { label: "Committed", isDone: true },
    {
      label: "Revealed",
      isDone: true,
      href: `https://kaspa.stream/transactions/${TXID}`,
    },
  ],
};

export const KRC20_RECORDS: HistoryRecord[] = [
  token("k-mint", "krc20", "mint", "1200000012345678", 19.235),
  token("k-send", "krc20", "send", "12323360832787357", 24000.235),
  token("k-recv", "krc20", "receive", "220043229438400", 2024000.235),
  token("k-mint-2", "krc20", "mint", "1200000012345600", 19.235),
];

export const KCC20_RECORDS: HistoryRecord[] = [
  token("c-recv", "kcc20", "receive", "1200000012345678", 19.235),
  token("c-send", "kcc20", "send", "12323360832787357", 24000.235),
  {
    ...token("c-pending", "kcc20", "receive", "100000000", 1.5),
    status: "pending",
  },
];

// Default for every story: the designed row. Only KRC-20 has hash steps; rows
// without a fiat value get a sample so the right column is visible too.
export const designedRow = (r: HistoryRecord) => ({
  ...(r.family === "krc20" ? KRC20_EXTRAS : COMMON_EXTRAS),
  ...(r.fiat.value ? {} : { fiatText: "≈ $19.235 USD" }),
});

const DETAIL_STATUS = {
  finalized: { label: "Finalized", tone: "success" },
  pending: { label: "Pending", tone: "pending" },
  failed: { label: "Failed", tone: "failed" },
  unknown: { label: "Unconfirmed", tone: "neutral" },
} as const;

// Default for the detail sheet: status and fiat as Leo's data would supply
// them. Rows without a fiat value get a sample so the Value row is visible.
export const designedDetail = (r: HistoryRecord) => ({
  status: DETAIL_STATUS[r.status],
  fiatText: historyFiatText(r) ?? "≈ $19.235 USD",
});
