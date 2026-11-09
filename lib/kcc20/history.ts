import { bytesToHex, hexToBytes } from "viem";
import { payToAddressScript } from "@/wasm/core/kaspa";
import { textEllipsis } from "@/lib/utils";
import {
  fetchTokenEvents,
  type KascovMovement,
  type KascovTokenEvent,
  type KascovTransfer,
} from "./providers/kascov";
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

// Replay reads the whole log from genesis; past this many pages it gives up (fallback stays).
// ponytail: tokens with thousands of events stay unattributed; a server-side owner_from on merges fixes them.
export const EVENT_LOG_PAGE_CAP = 3;
// Subset search budget per transition; past it the transition counts as unresolved.
const SUBSET_STEP_CAP = 50_000;

type Cell = { owner: string; amount: bigint };

/**
 * The one canonical set of `cells` summing to `total`, or undefined when there is none or
 * more than one. Cells with equal owner and amount are interchangeable, so they count once.
 */
function uniqueSpend(
  cells: readonly Cell[],
  total: bigint,
): Cell[] | undefined {
  const groups = new Map<string, { cell: Cell; n: number }>();
  // A zero cell changes no sum, so it would make every answer look twofold.
  for (const c of cells) {
    if (c.amount === 0n) continue;
    const k = `${c.owner}|${c.amount}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { cell: c, n: 1 });
  }
  const list = [...groups.values()].sort((a, b) =>
    a.cell.amount < b.cell.amount ? 1 : -1,
  );
  const rest: bigint[] = [];
  for (let i = list.length - 1, acc = 0n; i >= 0; i--)
    rest[i] = acc += list[i].cell.amount * BigInt(list[i].n);
  const found: Cell[][] = [];
  const pick: Cell[] = [];
  let steps = 0;
  const walk = (i: number, need: bigint): boolean => {
    if (++steps > SUBSET_STEP_CAP) return false;
    if (need === 0n) {
      found.push([...pick]);
      return found.length < 2;
    }
    if (i === list.length || rest[i] < need) return true;
    const { cell, n } = list[i];
    for (let k = Math.min(n, Number(need / cell.amount)); k >= 0; k--) {
      for (let j = 0; j < k; j++) pick.push(cell);
      const go = walk(i + 1, need - cell.amount * BigInt(k));
      pick.length -= k;
      if (!go) return false;
    }
    return true;
  };
  const done = walk(0, total);
  return done && found.length === 1 ? found[0] : undefined;
}

/**
 * Per-transition movements replayed from a token's event log, keyed `txid:seq`.
 * The log names every output cell but no merge input, so each transition's inputs are the
 * unique set of live cells (of `owner_from` when named) summing to its outputs. The first
 * transition that does not resolve ends the replay: every later live set would be a guess.
 * Movements exist only when one side has a single owner, so each pair is exact.
 */
export function replayEventLog(
  events: readonly KascovTokenEvent[],
): Map<string, KascovMovement[]> {
  const byTx = new Map<string, KascovTokenEvent[]>();
  for (const e of [...events].sort(
    (a, b) => a.seq - b.seq || a.deltaIdx - b.deltaIdx,
  )) {
    const id = `${e.txid}:${e.seq}`;
    byTx.set(id, [...(byTx.get(id) ?? []), e]);
  }
  let live: Cell[] = [];
  const out = new Map<string, KascovMovement[]>();
  for (const [id, deltas] of byTx) {
    const total = deltas.reduce((s, e) => s + e.amount, 0n);
    const from = deltas[0].ownerFrom;
    let spent: Cell[] = [];
    // Genesis: nothing exists yet, outputs come from nowhere.
    if (live.length > 0) {
      const found = uniqueSpend(
        from ? live.filter((c) => c.owner === from) : live,
        total,
      );
      if (!found) break;
      spent = found;
      // Equal cells are interchangeable: drop any one per pick.
      for (const c of spent)
        live.splice(
          live.findIndex((x) => x.owner === c.owner && x.amount === c.amount),
          1,
        );
    }
    live = [
      ...live,
      ...deltas.map((e) => ({ owner: e.ownerTo, amount: e.amount })),
    ];

    const net = new Map<string, bigint>();
    for (const c of spent)
      net.set(c.owner, (net.get(c.owner) ?? 0n) - c.amount);
    for (const e of deltas)
      net.set(e.ownerTo, (net.get(e.ownerTo) ?? 0n) + e.amount);
    const losers = [...net].filter(([, v]) => v < 0n);
    const gainers = [...net].filter(([, v]) => v > 0n);
    if (losers.length === 1)
      out.set(
        id,
        gainers.map(([o, v]) => ({
          ownerFrom: losers[0][0],
          ownerTo: o,
          amount: v,
        })),
      );
    else if (gainers.length === 1)
      out.set(
        id,
        losers.map(([o, v]) => ({
          ownerFrom: o,
          ownerTo: gainers[0][0],
          amount: -v,
        })),
      );
  }
  return out;
}

const needsLog = (r: KascovTransfer) =>
  r.status !== "exact" && r.status !== "self";

/**
 * `rows` with each one kascov could not attribute filled from the token's event log.
 * Reads the log once, and only when some row needs it; a row the replay cannot resolve
 * keeps its status, so it still shows as unattributed.
 */
export async function attributeFromEventLog(
  rows: readonly KascovTransfer[],
  tokenId: string,
  fetchEvents: typeof fetchTokenEvents = fetchTokenEvents,
): Promise<readonly KascovTransfer[]> {
  if (!rows.some(needsLog)) return rows;
  const events: KascovTokenEvent[] = [];
  let beforeSeq: number | undefined;
  for (let page = 0; ; page++) {
    if (page === EVENT_LOG_PAGE_CAP) return rows;
    const res = await fetchEvents(tokenId, beforeSeq);
    events.push(...res.events);
    if (res.nextBeforeSeq === undefined) break;
    beforeSeq = res.nextBeforeSeq;
  }
  const log = replayEventLog(events);
  return rows.map((r) => {
    const movements = needsLog(r) ? log.get(`${r.txid}:${r.seq}`) : undefined;
    return movements ? { ...r, status: "exact", movements } : r;
  });
}

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

const sum = (ds: readonly KascovTokenEvent[]) =>
  ds.reduce((s, d) => s + d.amount, 0n);

/**
 * One entry per transition of the event log that touches the wallet, in log order: the
 * fallback when /transfers has no rows (it covers verified-market tokens only).
 * A split names its one source owner on every delta, so what the wallet lost or gained
 * reads straight off the deltas. A merge names no input owner: the wallet's share of its
 * inputs is unknown, so that row stays unattributed and carries no amount.
 */
export function eventEntries(
  events: readonly KascovTokenEvent[],
  own: ReadonlySet<string>,
  tip: DaaTip,
): Kcc20HistoryEntry[] {
  const byId = new Map<string, KascovTokenEvent[]>();
  for (const e of events) {
    const id = `${e.txid}:${e.seq}`;
    byId.set(id, [...(byId.get(id) ?? []), e]);
  }
  const entries: Kcc20HistoryEntry[] = [];
  for (const [id, ds] of byId) {
    const from = ds[0].ownerFrom;
    const toOwn = ds.filter((d) => own.has(d.ownerTo));
    const out = ds.filter((d) => !own.has(d.ownerTo));
    const fromOwn = from !== undefined && own.has(from);
    if (!fromOwn && toOwn.length === 0) continue;
    const base = {
      id,
      txid: ds[0].txid,
      seq: ds[0].seq,
      acceptingDaa: ds[0].acceptingDaa,
      timestampMs: daaToMs(ds[0].acceptingDaa, tip.daa, tip.atMs),
      approxTime: true as const,
    };
    if (!from || ds.some((d) => d.ownerFrom !== from))
      entries.push({ ...base, kind: "unknown", ambiguous: true });
    else if (!fromOwn)
      entries.push({
        ...base,
        kind: "receive",
        amount: sum(toOwn),
        ambiguous: false,
        counterparty: from,
      });
    else if (out.length === 0)
      entries.push({ ...base, kind: "self", ambiguous: false });
    else {
      const to = new Set(out.map((d) => d.ownerTo));
      entries.push({
        ...base,
        kind: "send",
        amount: sum(out),
        ambiguous: false,
        ...(to.size === 1 && { counterparty: [...to][0] }),
      });
    }
  }
  return entries;
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
