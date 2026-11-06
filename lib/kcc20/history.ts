import { bytesToHex, hexToBytes } from "viem";
import { payToAddressScript } from "@/wasm/core/kaspa";
import { textEllipsis } from "@/lib/utils";
import type { KascovTransfer } from "./providers/kascov";
import { hash } from "./standard/primitives";

// Mainnet runs 10 blocks per second, so one DAA step is 100 ms.
const MS_PER_DAA = 100;

export type Kcc20HistoryKind =
  | "receive"
  | "send"
  | "self"
  | "buy"
  | "sell"
  // An ambiguous row with no trade label: kascov will not name its sender.
  | "unknown";

export type Kcc20HistoryEntry = {
  id: string;
  txid: string;
  seq: number;
  kind: Kcc20HistoryKind;
  // Base units moved across the wallet's boundary; absent when kascov could not attribute it.
  amount?: bigint;
  ambiguous: boolean;
  // The other side when every crossing movement shares one.
  counterparty?: string;
  acceptingDaa: number;
  timestampMs: number;
  // Derived from DAA distance to the tip, not a block timestamp.
  approxTime: true;
};

// A row from the wallet's trade feed; only its txid and side matter here.
export type Kcc20TradeRef = { txid: string; side?: "buy" | "sell" };

export type DaaTip = { daa: number; atMs: number };

/** The x-only key of a Schnorr P2PK wallet; any other address has no standard owner. */
export function standardOwnerKey(address: string): Uint8Array | undefined {
  try {
    const pk = /^20([0-9a-f]{64})ac$/.exec(
      payToAddressScript(address).script,
    )?.[1];
    return pk ? hexToBytes(`0x${pk}`) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every owner string this x-only key may appear as: bare, `presence:`, and `p2pkh:` (owner tuple 01).
 * All three belong in the own-set; /transfers rejects `p2pkh:` as a filter (400), so query the first two.
 */
export function ownerStrings(walletPubkey32: Uint8Array): string[] {
  const pk = bytesToHex(walletPubkey32).slice(2);
  return [
    pk,
    `presence:${pk}`,
    `p2pkh:${bytesToHex(hash(walletPubkey32)).slice(2)}`,
  ];
}

/** Approximate wall-clock time of `acceptingDaa`, counted back from a tip read at `tipAtMs`. */
export const daaToMs = (
  acceptingDaa: number,
  tipDaa: number,
  tipAtMs: number,
) => tipAtMs - (tipDaa - acceptingDaa) * MS_PER_DAA;

function entryOf(
  row: KascovTransfer,
  own: ReadonlySet<string>,
  trades: ReadonlyMap<string, Kcc20TradeRef>,
  tip: DaaTip,
): Kcc20HistoryEntry {
  const base = {
    id: `${row.txid}:${row.seq}`,
    txid: row.txid,
    seq: row.seq,
    acceptingDaa: row.acceptingDaa,
    timestampMs: daaToMs(row.acceptingDaa, tip.daa, tip.atMs),
    approxTime: true as const,
  };
  const market = row.marketId && `covenant:${row.marketId}`;
  const trade = trades.get(row.txid);
  const tradeSide = trade?.side ?? row.marketSide;

  // A self row moved the wallet's own cells; there is no payment to show.
  if (row.status === "self") return { ...base, kind: "self", ambiguous: false };
  // Movements exist only when every input had one known owner; anything else stays amountless.
  if (row.status !== "exact")
    return { ...base, kind: tradeSide ?? "unknown", ambiguous: true };

  let received = 0n;
  let sent = 0n;
  let internal = 0n;
  const others = new Set<string>();
  for (const m of row.movements) {
    const fromOwn = own.has(m.ownerFrom);
    const toOwn = own.has(m.ownerTo);
    if (fromOwn && toOwn) internal += m.amount;
    else if (toOwn) {
      received += m.amount;
      others.add(m.ownerFrom);
    } else if (fromOwn) {
      sent += m.amount;
      others.add(m.ownerTo);
    }
  }
  const counterparty = others.size === 1 ? [...others][0] : undefined;
  if (received === sent)
    return {
      ...base,
      kind: "self",
      ambiguous: false,
      ...(internal > 0n && received === 0n && { amount: internal }),
    };
  const incoming = received > sent;
  const isTrade =
    trade !== undefined ||
    (market !== undefined && others.has(market)) ||
    row.marketSide !== undefined;
  const kind = isTrade
    ? incoming
      ? "buy"
      : "sell"
    : incoming
      ? "receive"
      : "send";
  return {
    ...base,
    kind,
    // Both directions in one transition (rare): show the net.
    amount: incoming ? received - sent : sent - received,
    ambiguous: false,
    ...(counterparty && { counterparty }),
  };
}

/**
 * History rows for the wallet, newest first, from transfers fetched under any of its owner
 * strings. Amounts come only from attributed movements, never from deltas.
 */
export function toHistoryEntries(
  rows: readonly KascovTransfer[],
  ownSet: ReadonlySet<string>,
  trades: readonly Kcc20TradeRef[],
  tip: DaaTip,
): Kcc20HistoryEntry[] {
  const byTxid = new Map(trades.map((t) => [t.txid, t]));
  const entries = new Map<string, Kcc20HistoryEntry>();
  for (const row of rows) {
    const id = `${row.txid}:${row.seq}`;
    if (!entries.has(id)) entries.set(id, entryOf(row, ownSet, byTxid, tip));
  }
  return [...entries.values()].sort(
    (a, b) => b.acceptingDaa - a.acceptingDaa || b.seq - a.seq,
  );
}

export type Kcc20HistoryDirection = "in" | "out" | "self";

/**
 * What one history row shows. kascov alone: no block time, fee or finality, so the time
 * is approximate and the status is never claimed.
 */
export type Kcc20HistoryRow = {
  id: string;
  txid: string;
  kind: Kcc20HistoryKind;
  direction: Kcc20HistoryDirection;
  // Base units; absent when kascov could not attribute the row.
  amount?: bigint;
  counterparty?: { address: string; label: string };
  // Counted back from kascov's DAA tip, never a block timestamp.
  timeMs: number;
  approxTime: true;
};

/** A KRON market is a covenant owner; anyone else shows as a key, shortened. */
export function counterpartyLabel(owner: string) {
  if (owner.startsWith("covenant:")) return "KRON market";
  return textEllipsis(owner.replace(/^(presence|p2pkh):/, ""));
}

function directionOf(kind: Kcc20HistoryKind): Kcc20HistoryDirection {
  if (kind === "receive" || kind === "buy") return "in";
  if (kind === "send" || kind === "sell") return "out";
  return "self";
}

export function toHistoryRow(entry: Kcc20HistoryEntry): Kcc20HistoryRow {
  // kascov could not attribute it: say so, never carry a figure.
  const unattributed = entry.ambiguous || entry.kind === "unknown";
  const kind: Kcc20HistoryKind = unattributed ? "unknown" : entry.kind;
  return {
    id: entry.id,
    txid: entry.txid,
    kind,
    direction: directionOf(kind),
    ...(!unattributed &&
      entry.amount !== undefined && { amount: entry.amount }),
    ...(!unattributed &&
      entry.counterparty && {
        counterparty: {
          address: entry.counterparty,
          label: counterpartyLabel(entry.counterparty),
        },
      }),
    timeMs: entry.timestampMs,
    approxTime: true,
  };
}
