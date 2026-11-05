import { formatUnits } from "viem";
import type { SwapActivityRecord } from "@/lib/activity/mappers";
import { KAT_L1_CHAIN_ID } from "@/lib/bridge/kat-bridge-history";
import { fetchKaspaTx } from "@/lib/bridge/kat-observed-fees";
import { DaaTip, toHistoryEntries } from "@/lib/kcc20/history";
import {
  KascovHolding,
  KascovTransfer,
  KascovTransferCursor,
  fetchOwnerMarketTransfers,
  fetchStandardHoldingsWithTip,
} from "@/lib/kcc20/providers/kascov";

/**
 * KCC-20 swaps (KAS ⇄ a KRON-curve or Braid token, on Kaspa L1) for the swap
 * activity page, ported from kastle-mobile's kcc20-swap-history.ts and
 * kcc20-swap-money.ts, folded into one module. Read-only: kascov's /transfers
 * for the wallet's owner strings (the token side), then the swap's own L1
 * transaction from api.kaspa.org (the KAS side and both fees).
 *
 * The rows are the extension's SwapActivityRecord, so mapSwapActivity and the
 * adapter render them unchanged. What each field means on a KCC-20 row — the
 * mappers.ts comment first, then how this module fills it:
 *
 * - id — `kcc20:<txid>:<seq>:<tokenId>`, one per token state transition: a
 *   transaction trading two tokens is two rows, never one.
 * - timestampMs — from the DAA distance to kascov's tip, not a block time.
 * - fromSymbol / toSymbol — "KAS" on the KAS side, the token's symbol on the other.
 * - fromAmount / toAmount — "Decimal strings in display units." The token side
 *   is kascov's attributed movement; a transition with none is dropped, never
 *   shown as 0. The KAS side is "0" until the L1 read fills it: the same
 *   unobserved-leg sentinel buildSwapRecords uses, which swapLeg() omits, so
 *   it never renders as a number.
 * - status — "pending" is reserved for in-flight local swaps; explorer rows
 *   never carry it. kascov lists accepted transitions only, each with its
 *   accepting_daa: "completed", as kastle-mobile's row says.
 * - txHash — the L1 txid; chainId routes its link to the Kaspa explorer.
 * - providerId — not set: no KRON / Braid venue is a registered provider, and
 *   swapVenueName() names none of them.
 * - feeAmount / feeSymbol — "Network (gas) fee in display units + its symbol,
 *   when the explorer supplied it." Here: inputs − outputs of the L1 tx, KAS.
 *   The network fee alone — the venue cut is never folded in.
 * - kastleFeeAmount / kastleFeeSymbol — "Kastle's fee-collector cut … exactly
 *   as the collector's own FeeCollected log stated it — never a rate applied to
 *   the input." On EVM rows that is the cut the venue path retains; here the
 *   venue's cut: outputs to plain addresses other than the wallet, as the tx
 *   states them. Absent when the tx paid none.
 * - kastleFeeUnobserved — "The swap definitely paid a cut and we could not
 *   read how much." Never set here: the sheet renders it as "-", and a value
 *   this module could not compute is left out, not dashed.
 * - chainId — "Chain the swap executed on." KAT_L1_CHAIN_ID (Kaspa L1).
 */

// ─── token side: kascov ──────────────────────────────────────────────────────

/** Pages per owner string. 4 × 50 transitions — an extension, not an indexer. */
const MAX_PAGES = 4;

/** Name + decimals for one token id, from the wallet's verified token list or kascov's holdings. */
export type Kcc20SwapTokenMeta = { symbol: string; decimals: number };

/**
 * What one read established, in the vocabulary mergeSwapHistories uses for a
 * chain. `unreachable` with rows is possible: one owner string answered and
 * the other did not, so the rows are real and the list may be short.
 */
export type Kcc20SwapHealth = "ok" | "truncated" | "unreachable";

export interface Kcc20SwapFetchResult {
  rows: KascovTransfer[];
  /** kascov's tip when it read the holdings; every row dates from it. Absent ⇒ unreachable. */
  tip?: DaaTip;
  holdings: KascovHolding[];
  health: Kcc20SwapHealth;
}

async function ownerPages(
  owner: string,
): Promise<{ rows: KascovTransfer[]; truncated: boolean }> {
  const rows: KascovTransfer[] = [];
  let cursor: KascovTransferCursor | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchOwnerMarketTransfers(owner, cursor);
    rows.push(...res.transfers);
    if (!res.next) return { rows, truncated: false };
    cursor = res.next;
  }
  return { rows, truncated: true };
}

/**
 * Raw transfers for every owner string `/transfers` accepts (bare and
 * `presence:` — layouts index one or the other, and legacy pieces never answer
 * to bare), plus the holdings doc that carries the DAA tip. Never throws.
 */
export async function fetchKcc20SwapTransfers(
  address: string,
  owners: readonly string[],
): Promise<Kcc20SwapFetchResult> {
  const [doc, ...perOwner] = await Promise.all([
    fetchStandardHoldingsWithTip(address).catch(() => null),
    ...owners.map((o) => ownerPages(o).catch(() => null)),
  ]);
  const read = perOwner.filter((r) => r !== null);
  const rows = read.flatMap((r) => r.rows);
  // Without a tip no row can be dated, so none is shown.
  if (!doc) return { rows: [], holdings: [], health: "unreachable" };
  return {
    rows,
    tip: doc.tip,
    holdings: doc.holdings,
    health:
      read.length < perOwner.length
        ? "unreachable"
        : read.some((r) => r.truncated)
          ? "truncated"
          : "ok",
  };
}

export interface BuildKcc20SwapRecordsInput {
  rows: readonly KascovTransfer[];
  /** Every owner string the wallet's key may appear as — ownerStrings(). */
  own: ReadonlySet<string>;
  tip: DaaTip;
  /** Lower-case token id → name + decimals. */
  tokens: ReadonlyMap<string, Kcc20SwapTokenMeta>;
}

export interface Kcc20SwapRecords {
  swaps: SwapActivityRecord[];
  /** Trades in a token neither source can name: no decimals, so no amount. */
  unidentified: number;
  /** Trades with no attributed token amount (or that failed to map): no amount to show. */
  unattributed: number;
}

/**
 * One swap record per trade transition. A transition is a swap when
 * toHistoryEntries calls it buy or sell: kascov labelled it a market trade, or
 * its tokens crossed to or from the market's covenant. Receives, sends and
 * self-merges are not swaps and are left out.
 *
 * A trade whose token amount cannot be computed is dropped and counted — in
 * `unidentified` when no source names the token, in `unattributed` when kascov
 * could not attribute the movement — so the page says the list is short
 * instead of printing 0. Mapping is per row: one bad row is skipped and
 * counted, never fatal to the rest.
 */
export function buildKcc20SwapRecords({
  rows,
  own,
  tip,
  tokens,
}: BuildKcc20SwapRecordsInput): Kcc20SwapRecords {
  const byToken = new Map<string, KascovTransfer[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    // The bare and `presence:` reads overlap, and so may page edges. The token
    // is in the key: two tokens' transitions in one transaction are two rows.
    const id = `${row.tokenId}:${row.txid}:${row.seq}`;
    if (seen.has(id)) continue;
    seen.add(id);
    byToken.set(row.tokenId, [...(byToken.get(row.tokenId) ?? []), row]);
  }

  const swaps: SwapActivityRecord[] = [];
  let unidentified = 0;
  let unattributed = 0;
  for (const [tokenId, tokenRows] of byToken) {
    let entries;
    try {
      entries = toHistoryEntries(tokenRows, own, [], tip);
    } catch {
      unattributed += tokenRows.length;
      continue;
    }
    for (const entry of entries) {
      if (entry.kind !== "buy" && entry.kind !== "sell") continue;
      const meta = tokens.get(tokenId);
      if (!meta) {
        unidentified++;
        continue;
      }
      try {
        const amount =
          entry.amount !== undefined && entry.amount > 0n
            ? formatUnits(entry.amount, meta.decimals)
            : null;
        if (amount === null || !Number.isFinite(entry.timestampMs)) {
          unattributed++;
          continue;
        }
        const buy = entry.kind === "buy";
        swaps.push({
          id: `kcc20:${entry.id}:${tokenId}`,
          timestampMs: entry.timestampMs,
          fromSymbol: buy ? "KAS" : meta.symbol,
          toSymbol: buy ? meta.symbol : "KAS",
          // KAS side: the unobserved-leg sentinel until applyKcc20SwapMoney.
          fromAmount: buy ? "0" : amount,
          toAmount: buy ? amount : "0",
          // kascov lists accepted transitions only: the row's accepting_daa.
          status: "completed",
          txHash: entry.txid,
          chainId: KAT_L1_CHAIN_ID,
        });
      } catch {
        unattributed++;
      }
    }
  }
  return { swaps, unidentified, unattributed };
}

/**
 * Token names for the join: the wallet's verified token list first (it names
 * legacy tokens from the registry), kascov's claimed holdings for the rest.
 */
export function kcc20SwapTokenMeta(
  verified: readonly {
    covenantId: string;
    meta?: { symbol: string; decimals: number };
  }[],
  holdings: readonly KascovHolding[],
): Map<string, Kcc20SwapTokenMeta> {
  const map = new Map<string, Kcc20SwapTokenMeta>();
  for (const t of verified)
    if (t.meta)
      map.set(t.covenantId.toLowerCase(), {
        symbol: t.meta.symbol,
        decimals: t.meta.decimals,
      });
  for (const h of holdings)
    if (
      !map.has(h.tokenId) &&
      h.claimedTicker &&
      h.displayDecimals !== undefined
    )
      map.set(h.tokenId, {
        symbol: h.claimedTicker,
        decimals: h.displayDecimals,
      });
  return map;
}

// ─── KAS side: the swap's own L1 transaction ─────────────────────────────────

/** Newest rows enriched per load. The rest keep their placeholder. */
export const KCC20_SWAP_MONEY_LIMIT = 20;

const KAS_DECIMALS = 8;

/** The subset of api.kaspa.org's /transactions/{txid} this module reads. */
interface MoneyTxInput {
  previous_outpoint_address?: string;
  previous_outpoint_amount?: number;
  covenant_id?: string | null;
}

interface MoneyTxOutput {
  amount?: number;
  script_public_key_address?: string;
  covenant_id?: string | null;
}

export interface Kcc20SwapTx {
  inputs?: MoneyTxInput[];
  outputs?: MoneyTxOutput[];
}

/** Sompi, observed. */
export interface Kcc20SwapMoney {
  /**
   * Buy: what left the wallet's address. Sell: what reached it. Both net of
   * the covenant bond, so this is the trade's price leg alone.
   */
  kasSompi: bigint;
  /** The network fee: inputs − outputs. Goes in feeAmount. */
  networkFeeSompi: bigint;
  /** The venue's cut: outputs to plain addresses other than the wallet. Goes in kastleFeeAmount. */
  venueFeeSompi: bigint;
}

function sompi(n: unknown): bigint | null {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0
    ? BigInt(n)
    : null;
}

/** An absent covenant_id and a null one both mean a plain UTXO. */
function covenantOf(u: { covenant_id?: string | null }): string | null {
  return typeof u.covenant_id === "string" && u.covenant_id
    ? u.covenant_id
    : null;
}

/**
 * KAS flows of one swap transaction, from the wallet's point of view. Null
 * when the transaction cannot answer without a guess.
 *
 * - kas: the wallet address's net plain-KAS movement in the trade's direction — a
 *   buy's outlay (network fee and venue cut included, change excluded), a
 *   sell's proceeds (net of both) — less the covenant bond, so Rate is the
 *   trade's price. The bond is the KAS a token UTXO carries: a buy locks it
 *   into the user's new token UTXO (2 KAS on the buy fixture) and a sell
 *   frees it from the token UTXOs it spends (0.5 KAS each on the sell
 *   fixture). It comes back when the token is spent, so it is not a cost.
 *   Read per covenant: the largest input and the largest output are the
 *   market's own UTXO carried forward (its state, or its KAS reserve), every
 *   other UTXO under that covenant is a bond, so the bond is the rest of the
 *   outputs minus the rest of the inputs. The bond has no record field, so it
 *   is left out of the sheet rather than shown. Only plain UTXOs count as the
 *   wallet's: a token UTXO at the wallet's own address is bond, already in the
 *   bond sum, and counting it as change too would take it off twice.
 * - networkFee: the API returns no fee field, so it is inputs − outputs. It is
 *   the Provider Fees row (feeAmount), as on the EVM rows, where that row is
 *   the gas fee alone.
 * - venueFee: outputs to plain addresses other than the wallet (on mainnet
 *   curve trades, one or two outputs to KRON's fee address). It goes in
 *   kastleFeeAmount, the field the EVM rows use for the venue path's cut. The
 *   pool's own fee stays inside the curve's reserve and is not separable from
 *   the price in one transaction, so it is in neither number.
 *
 * Any input funded by a plain address other than the wallet makes the
 * third-party outputs unattributable (they may be that party's change), so
 * the whole read is refused rather than half-answered.
 *
 * So is a transaction under more than two covenants. One token's trade spans
 * exactly one pair: the token's own covenant (its id is the token id) and its
 * market's — 147dff… and ee6154… on the buy fixture, 28c8fb… and 7b97bb… on
 * the sell. A second token adds its own, and then the wallet's KAS is the
 * outlay of both legs, which no row may print as its own, even when the other
 * token's row was dropped and this row looks like the transaction's only one.
 */
export function deriveKcc20SwapMoney(
  tx: Kcc20SwapTx,
  address: string,
  side: "buy" | "sell",
): Kcc20SwapMoney | null {
  if (!tx.inputs?.length || !tx.outputs?.length) return null;
  // Per covenant: [sum, largest] of its inputs and of its outputs.
  const covenants = new Map<
    string,
    { inSum: bigint; inMax: bigint; outSum: bigint; outMax: bigint }
  >();
  const covenant = (id: string) => {
    let c = covenants.get(id);
    if (!c)
      covenants.set(id, (c = { inSum: 0n, inMax: 0n, outSum: 0n, outMax: 0n }));
    return c;
  };
  let inputs = 0n;
  let walletIn = 0n;
  let funded = false;
  for (const i of tx.inputs) {
    const amount = sompi(i?.previous_outpoint_amount);
    if (amount === null || !i.previous_outpoint_address) return null;
    inputs += amount;
    const id = covenantOf(i);
    if (id) {
      const c = covenant(id);
      c.inSum += amount;
      if (amount > c.inMax) c.inMax = amount;
    }
    if (i.previous_outpoint_address === address) {
      funded = true;
      if (!id) walletIn += amount;
    } else if (!id) return null;
  }
  let outputs = 0n;
  let walletOut = 0n;
  let venue = 0n;
  for (const o of tx.outputs) {
    const amount = sompi(o?.amount);
    if (amount === null || !o.script_public_key_address) return null;
    outputs += amount;
    const id = covenantOf(o);
    if (id) {
      const c = covenant(id);
      c.outSum += amount;
      if (amount > c.outMax) c.outMax = amount;
      continue;
    }
    if (o.script_public_key_address === address) walletOut += amount;
    else venue += amount;
  }
  const networkFee = inputs - outputs;
  // The wallet did not fund it, so neither fee is the wallet's.
  if (networkFee < 0n || !funded) return null;
  // More than one token/market pair: the KAS cannot be pinned to one row.
  if (covenants.size > 2) return null;
  // Locked by this tx (buy) when positive, freed by it (sell) when negative.
  // Assumes the market's state or reserve UTXO is the largest under its
  // covenant; a state UTXO smaller than a bond, or one covenant carrying both
  // a state and a reserve UTXO, would count the market's own KAS as bond.
  let bond = 0n;
  for (const c of covenants.values())
    bond += c.outSum - c.outMax - (c.inSum - c.inMax);
  if (side === "buy" ? bond < 0n : bond > 0n) return null;
  const kasSompi =
    side === "buy" ? walletIn - walletOut - bond : walletOut - walletIn + bond;
  if (kasSompi <= 0n) return null;
  return { kasSompi, networkFeeSompi: networkFee, venueFeeSompi: venue };
}

/** "kcc20:<txid>:<seq>:<tokenId>" — the id buildKcc20SwapRecords gives every row. */
export function kcc20SwapTxid(record: SwapActivityRecord): string | null {
  const m = /^kcc20:([0-9a-f]{64}):/.exec(record.id);
  return m ? m[1] : null;
}

/**
 * Txids carried by exactly one row. buildKcc20SwapRecords makes one row per
 * token, so a trade touching two tokens is two rows of one transaction. Its
 * KAS cannot be split between them — the transaction does not say which
 * token's leg each sompi paid for, and an even split would print a number the
 * chain never said — so those rows keep their placeholder instead.
 */
function singleRowTxids(swaps: readonly SwapActivityRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of swaps) {
    const txid = kcc20SwapTxid(s);
    if (txid) counts.set(txid, (counts.get(txid) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n === 1).map(([t]) => t));
}

/**
 * Successful reads only, per wallet address and txid. A confirmed transaction
 * never changes, so a hit never goes stale; a failure is not cached, so one
 * timeout does not blank a row for the life of the popup.
 */
const moneyByTx = new Map<string, Kcc20SwapMoney>();

/** Test seam — a fresh popup starts empty, so only tests need this. */
export function clearKcc20SwapMoneyCache(): void {
  moneyByTx.clear();
}

/**
 * Txids of the newest KCC20_SWAP_MONEY_LIMIT rows, newest first, one per
 * transaction, leaving out any transaction more than one row shares.
 */
export function kcc20SwapMoneyTxids(
  swaps: readonly SwapActivityRecord[],
): string[] {
  const single = singleRowTxids(swaps);
  const txids: string[] = [];
  for (const s of [...swaps].sort((a, b) => b.timestampMs - a.timestampMs)) {
    const txid = kcc20SwapTxid(s);
    if (txid && single.has(txid)) txids.push(txid);
    if (txids.length === KCC20_SWAP_MONEY_LIMIT) break;
  }
  return txids;
}

/**
 * Reads every transaction in `swaps` it is asked for, each on its own: one
 * that 404s, times out or will not derive leaves that row out of the map and
 * every other row in it. Never throws.
 */
export async function fetchKcc20SwapMoney(
  address: string,
  swaps: readonly SwapActivityRecord[],
): Promise<Map<string, Kcc20SwapMoney>> {
  const out = new Map<string, Kcc20SwapMoney>();
  const sides = new Map<string, "buy" | "sell">();
  for (const s of swaps) {
    const txid = kcc20SwapTxid(s);
    if (txid) sides.set(txid, s.fromSymbol === "KAS" ? "buy" : "sell");
  }
  await Promise.allSettled(
    kcc20SwapMoneyTxids(swaps).map(async (txid) => {
      const key = `${address}:${txid}`;
      const hit = moneyByTx.get(key);
      if (hit) return void out.set(txid, hit);
      const tx = (await fetchKaspaTx(txid)) as Kcc20SwapTx | null;
      const money = tx && deriveKcc20SwapMoney(tx, address, sides.get(txid)!);
      if (!money) return;
      moneyByTx.set(key, money);
      out.set(txid, money);
    }),
  );
  return out;
}

/**
 * The swap rows with their KAS leg and fees filled from `money`, in the fields
 * the EVM rows already use: the KAS amount on its side, the network fee as
 * feeAmount/feeSymbol, the venue's cut as kastleFeeAmount/kastleFeeSymbol.
 * The sheet's Rate follows from the two legs. A row without a read — refused,
 * shared with another row, failed, or past the limit — keeps its placeholder:
 * the KAS leg stays the unobserved sentinel and both fees stay absent. Per
 * row: one that throws is returned as it came in.
 */
export function applyKcc20SwapMoney(
  swaps: readonly SwapActivityRecord[],
  money: ReadonlyMap<string, Kcc20SwapMoney>,
): SwapActivityRecord[] {
  const single = singleRowTxids(swaps);
  return swaps.map((s) => {
    try {
      const txid = kcc20SwapTxid(s);
      const m = txid && single.has(txid) ? money.get(txid) : undefined;
      if (!m) return s;
      const kas = formatUnits(m.kasSompi, KAS_DECIMALS);
      return {
        ...s,
        ...(s.fromSymbol === "KAS" ? { fromAmount: kas } : { toAmount: kas }),
        feeAmount: formatUnits(m.networkFeeSompi, KAS_DECIMALS),
        feeSymbol: "KAS",
        // Paid nothing leaves the cut unset, as on the EVM rows: no "0 KAS" row.
        ...(m.venueFeeSompi > 0n
          ? {
              kastleFeeAmount: formatUnits(m.venueFeeSompi, KAS_DECIMALS),
              kastleFeeSymbol: "KAS",
            }
          : {}),
      };
    } catch {
      return s;
    }
  });
}
