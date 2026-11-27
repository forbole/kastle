import { formatUnits } from "viem";
import type { Tx } from "@dotk/sdk-tx";
import type { SwapActivityRecord } from "@/lib/activity/mappers";
import { braidWalletJsonToTx } from "@/lib/braid/adapter";
import { BRAID_PROVIDER } from "@/lib/braid/constants";
import type { BraidSettleState, PendingBraidSwap } from "@/lib/braid/pending";
import { KAT_L1_CHAIN_ID } from "@/lib/bridge/kat-bridge-history";
import { fetchKaspaTx } from "@/lib/bridge/kat-observed-fees";
import { requestJson } from "@/lib/bridge/kat-registry";
import { KASPA_REST_APIS } from "@/lib/activity/externals";
import { NetworkType } from "@/contexts/SettingsContext";
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

/**
 * Name + decimals for one token id, from the wallet's verified token list or
 * kascov's holdings. No decimals (a KaspaRocket token declares none): the row
 * still shows, its token amount left out.
 */
export type Kcc20SwapTokenMeta = { symbol: string; decimals?: number };

/** A traded token no source names: still a row, never a dropped one. */
export const UNKNOWN_TOKEN_SYMBOL = "Unknown token";

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
  /**
   * Braid sells until the chain confirms them: the wallet's token sent to a
   * `script:` owner, as a Braid deposit sends it. Any P2SH may receive a
   * token, so none is a swap row until fetchBraidTxids reads its BRT1 payload.
   */
  braidSells: SwapActivityRecord[];
  /** Trades with no attributed token amount (or that failed to map): no amount to show. */
  unattributed: number;
}

/**
 * One swap record per trade transition. A transition is a swap when
 * toHistoryEntries calls it buy or sell: kascov labelled it a market trade, or
 * its tokens crossed to or from the market's covenant. Receives, sends and
 * self-merges are not swaps and are left out.
 *
 * A trade in a token no source names is still a row: UNKNOWN_TOKEN_SYMBOL
 * when nothing names it, the token leg the unobserved sentinel when nothing
 * gives its decimals. Venue and naming are not what makes a swap a swap. A
 * trade kascov could not attribute is dropped and counted in `unattributed`,
 * so the page says the list is short instead of printing 0. Mapping is per
 * row: one bad row is skipped and counted, never fatal to the rest.
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
  const braidSells: SwapActivityRecord[] = [];
  let unattributed = 0;
  for (const [tokenId, tokenRows] of byToken) {
    let entries;
    try {
      entries = toHistoryEntries(tokenRows, own, [], tip);
    } catch {
      unattributed += tokenRows.length;
      continue;
    }
    const meta = tokens.get(tokenId);
    const symbol = meta?.symbol ?? UNKNOWN_TOKEN_SYMBOL;
    for (const entry of entries) {
      const braidSell =
        entry.kind === "send" &&
        !!entry.counterparty?.startsWith("script:") &&
        entry.amount !== undefined &&
        entry.amount > 0n;
      if (entry.kind !== "buy" && entry.kind !== "sell" && !braidSell) continue;
      try {
        if (
          entry.amount === undefined ||
          entry.amount <= 0n ||
          !Number.isFinite(entry.timestampMs)
        ) {
          unattributed++;
          continue;
        }
        // No decimals: the unobserved-leg sentinel, never base units as display units.
        const amount =
          meta?.decimals === undefined
            ? "0"
            : formatUnits(entry.amount, meta.decimals);
        if (braidSell) {
          // A Braid refund hands the token back from the same router note.
          const refunded = entries.some(
            (e) =>
              e.kind === "receive" && e.counterparty === entry.counterparty,
          );
          braidSells.push({
            id: `braid:${entry.id}:${tokenId}`,
            timestampMs: entry.timestampMs,
            fromSymbol: symbol,
            toSymbol: "KAS",
            fromAmount: amount,
            // Braid pays the KAS in its own settle transaction: unobserved here.
            toAmount: "0",
            status: refunded ? "failed" : "completed",
            txHash: entry.txid,
            providerId: BRAID_PROVIDER.id,
            chainId: KAT_L1_CHAIN_ID,
            tokenId: tokenId.toLowerCase(),
          });
          continue;
        }
        const buy = entry.kind === "buy";
        // The venue, from kascov's verified market build ("KRON pool v1").
        // ponytail: its first word as id; adapters name and draw only the
        // venues L1_PROVIDERS knows (KRON, Braid), others get no Provider row.
        const venue = tokenRows
          .find((r) => r.txid === entry.txid && r.marketBuild)
          ?.marketBuild?.split(" ")[0]
          ?.toLowerCase();
        swaps.push({
          id: `kcc20:${entry.id}:${tokenId}`,
          timestampMs: entry.timestampMs,
          fromSymbol: buy ? "KAS" : symbol,
          toSymbol: buy ? symbol : "KAS",
          // KAS side: the unobserved-leg sentinel until applyKcc20SwapMoney.
          fromAmount: buy ? "0" : amount,
          toAmount: buy ? amount : "0",
          // kascov lists accepted transitions only: the row's accepting_daa.
          status: "completed",
          txHash: entry.txid,
          ...(venue ? { providerId: venue } : {}),
          chainId: KAT_L1_CHAIN_ID,
          tokenId: tokenId.toLowerCase(),
        });
      } catch {
        unattributed++;
      }
    }
  }
  return { swaps, braidSells, unattributed };
}

/**
 * Token names for the join: the wallet's verified token list first (it names
 * legacy tokens from the registry), kascov's claimed holdings next, then
 * KRON's registry (the markets download the screen already makes) for a
 * token the wallet no longer holds — a sold-out token keeps its name and
 * amount. Each later source fills only what the earlier left out.
 */
export function kcc20SwapTokenMeta(
  verified: readonly {
    covenantId: string;
    meta?: { symbol: string; decimals?: number };
  }[],
  holdings: readonly KascovHolding[],
  registry: readonly {
    covenantId: string;
    entry: { symbol: string; decimals: number };
  }[] = [],
): Map<string, Kcc20SwapTokenMeta> {
  const map = new Map<string, Kcc20SwapTokenMeta>();
  // A ticker without a scale still names the row; either source may fill the scale.
  for (const t of verified)
    if (t.meta?.symbol)
      map.set(t.covenantId.toLowerCase(), {
        symbol: t.meta.symbol,
        decimals: t.meta.decimals,
      });
  for (const h of holdings) {
    const m = map.get(h.tokenId);
    const symbol = m?.symbol ?? h.claimedTicker;
    if (symbol)
      map.set(h.tokenId, {
        symbol,
        decimals: m?.decimals ?? h.displayDecimals,
      });
  }
  for (const { covenantId, entry } of registry) {
    const id = covenantId.toLowerCase();
    const m = map.get(id);
    const symbol = m?.symbol ?? entry.symbol;
    if (symbol)
      map.set(id, {
        symbol,
        decimals:
          m?.decimals ??
          (Number.isInteger(entry.decimals) ? entry.decimals : undefined),
      });
  }
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
  previous_outpoint_hash?: string;
  previous_outpoint_index?: string | number;
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
 * the whole read is refused rather than half-answered. One exception: a
 * KRON swap (lib/kcc20/swap.ts) spends a P2SH output the wallet's own
 * commit transaction made. Given that commit in `commits` (by txid), the
 * input counts as the wallet's when every commit input is the wallet's
 * plain UTXO and the commit output matches it; the commit's own fee then
 * joins the network fee and the wallet's outlay.
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
  commits: ReadonlyMap<string, Kcc20SwapTx> = new Map(),
): Kcc20SwapMoney | null {
  if (!tx.inputs?.length || !tx.outputs?.length) return null;
  const commitFees = new Map<string, bigint>();
  // The wallet funded this input through its own commit tx: commit fee, or null.
  const commitFee = (i: MoneyTxInput, amount: bigint): bigint | null => {
    const c = i.previous_outpoint_hash
      ? commits.get(i.previous_outpoint_hash)
      : undefined;
    const o = c?.outputs?.[Number(i.previous_outpoint_index)];
    if (!c?.inputs?.length || !c.outputs?.length || !o) return null;
    if (
      o.script_public_key_address !== i.previous_outpoint_address ||
      sompi(o.amount) !== amount
    )
      return null;
    let sum = 0n;
    for (const ci of c.inputs) {
      const a = sompi(ci?.previous_outpoint_amount);
      if (
        a === null ||
        covenantOf(ci) ||
        ci.previous_outpoint_address !== address
      )
        return null;
      sum += a;
    }
    for (const co of c.outputs) {
      const a = sompi(co?.amount);
      if (a === null) return null;
      sum -= a;
    }
    return sum >= 0n ? sum : null;
  };
  let inputs = 0n;
  let walletIn = 0n;
  let funded = false;
  for (const i of tx.inputs) {
    const amount = sompi(i?.previous_outpoint_amount);
    if (amount === null || !i.previous_outpoint_address) return null;
    inputs += amount;
    const id = covenantOf(i);
    if (i.previous_outpoint_address === address) {
      funded = true;
      if (!id) walletIn += amount;
    } else if (!id) {
      const fee = commitFee(i, amount);
      if (fee === null) return null;
      funded = true;
      walletIn += amount;
      commitFees.set(i.previous_outpoint_hash!, fee);
    }
  }
  let outputs = 0n;
  let walletOut = 0n;
  let venue = 0n;
  for (const o of tx.outputs) {
    const amount = sompi(o?.amount);
    if (amount === null || !o.script_public_key_address) return null;
    outputs += amount;
    if (covenantOf(o)) continue;
    if (o.script_public_key_address === address) walletOut += amount;
    else venue += amount;
  }
  const networkFee = inputs - outputs;
  // The wallet did not fund it, so neither fee is the wallet's.
  if (networkFee < 0n || !funded) return null;
  const { bond, covenants } = covenantBond(tx);
  // More than one token/market pair: the KAS cannot be pinned to one row.
  if (covenants > 2) return null;
  if (side === "buy" ? bond < 0n : bond > 0n) return null;
  let committed = 0n;
  for (const f of commitFees.values()) committed += f;
  const kasSompi =
    side === "buy"
      ? walletIn - walletOut - bond + committed
      : walletOut - walletIn + bond - committed;
  if (kasSompi <= 0n) return null;
  return {
    kasSompi,
    networkFeeSompi: networkFee + committed,
    venueFeeSompi: venue,
  };
}

/**
 * The covenant bond a transaction locks (positive) or frees (negative), and
 * how many covenants it touches. Per covenant, the largest input and the
 * largest output are the market's own UTXO carried forward; the rest is bond.
 * Assumes the market's state or reserve UTXO is the largest under its
 * covenant; a state UTXO smaller than a bond, or one covenant carrying both
 * a state and a reserve UTXO, would count the market's own KAS as bond.
 * Callers have checked every amount is a sompi value.
 */
function covenantBond(tx: Kcc20SwapTx): { bond: bigint; covenants: number } {
  const per = new Map<
    string,
    { inSum: bigint; inMax: bigint; outSum: bigint; outMax: bigint }
  >();
  const add = (id: string | null, amount: bigint, side: "in" | "out") => {
    if (!id) return;
    let c = per.get(id);
    if (!c) per.set(id, (c = { inSum: 0n, inMax: 0n, outSum: 0n, outMax: 0n }));
    if (side === "in") {
      c.inSum += amount;
      if (amount > c.inMax) c.inMax = amount;
    } else {
      c.outSum += amount;
      if (amount > c.outMax) c.outMax = amount;
    }
  };
  for (const i of tx.inputs ?? [])
    add(covenantOf(i), sompi(i.previous_outpoint_amount) ?? 0n, "in");
  for (const o of tx.outputs ?? [])
    add(covenantOf(o), sompi(o.amount) ?? 0n, "out");
  let bond = 0n;
  for (const c of per.values())
    bond += c.outSum - c.outMax - (c.inSum - c.inMax);
  return { bond, covenants: per.size };
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

/**
 * Every transaction this module reads, by txid, shared by the money read and
 * the Braid read: a Braid buy's settle and its deposit are each fetched once,
 * not once per reader. In flight reads are shared too (both SWR entries fire
 * on the same render). A failed read is dropped, so the next ask retries.
 * ponytail: holds whole API objects (signature scripts included, up to
 * ~100 KB each) for the popup's life, bounded by the newest-20 limits; slim
 * them to the fields read if a long-lived page ever holds this module.
 */
const txById = new Map<string, Promise<BraidReadTx | null>>();

function readTx(txid: string): Promise<BraidReadTx | null> {
  let p = txById.get(txid);
  if (!p) {
    p = fetchKaspaTx(txid).then(
      (tx) => {
        if (!tx) txById.delete(txid);
        return tx as BraidReadTx | null;
      },
      () => {
        txById.delete(txid);
        return null;
      },
    );
    txById.set(txid, p);
  }
  return p;
}

/** Test seam — a fresh popup starts empty, so only tests need this. */
export function clearKcc20SwapMoneyCache(): void {
  moneyByTx.clear();
  braidByTx.clear();
  braidSettleByTx.clear();
  txById.clear();
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
      const tx = await readTx(txid);
      if (!tx) return;
      // A KRON swap spends the wallet's own commit output: read that commit too.
      const commitIds = new Set(
        (tx.inputs ?? [])
          .filter(
            (i) =>
              !covenantOf(i) &&
              i.previous_outpoint_address !== address &&
              i.previous_outpoint_hash,
          )
          .map((i) => i.previous_outpoint_hash!),
      );
      const commits = new Map<string, Kcc20SwapTx>();
      for (const id of commitIds) {
        const c = await readTx(id);
        if (!c) return;
        commits.set(id, c);
      }
      const money = deriveKcc20SwapMoney(
        tx,
        address,
        sides.get(txid)!,
        commits,
      );
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

// ─── Braid: which trades went through it, from the chain ─────────────────────

/**
 * "BRT1": the recovery payload every Braid router deposit carries
 * (@braid_swap/sdk/recover decodeBrt). The deposit's own transaction names
 * the venue, so no local record or listing is needed to know it.
 */
const BRT1_PAYLOAD = "42525431";

interface BraidReadTx extends Kcc20SwapTx {
  payload?: string;
}

const isBraidDeposit = (tx: BraidReadTx | null) =>
  !!tx?.payload?.toLowerCase().startsWith(BRT1_PAYLOAD);

/** The router coin a Braid deposit made: what the settle spends. */
export interface BraidRouterCoin {
  index: number;
  address: string;
  amountSompi: bigint;
}

/** What a sell's own deposit says, read with no request beyond the one that names it Braid. */
export interface BraidDeposit {
  /** inputs − outputs; absent when a plain input is not the wallet's (no guess). */
  networkFeeSompi?: bigint;
  coin?: BraidRouterCoin;
}

/** Confirmed transactions never change: both answers are final. Per address and txid. */
const braidByTx = new Map<string, { braid: boolean; deposit?: BraidDeposit }>();

/**
 * The index of a deposit's router coin: its one plain P2SH output (Braid's
 * verifyDeposit admits no other — the note and token change carry a
 * covenant, the KAS change is the depositor's P2PK).
 * ponytail: structural, not re-derived; re-deriving the coin's script needs
 * the router program bytes, which only the node-only recover module embeds.
 */
function routerCoinIndex(tx: BraidReadTx): number | undefined {
  const outs = tx.outputs ?? [];
  const coins = outs.flatMap((o, i) =>
    !covenantOf(o) && o.script_public_key_address?.startsWith("kaspa:p")
      ? [i]
      : [],
  );
  return coins.length === 1 ? coins[0] : undefined;
}

/** The deposit's fee (when the wallet alone funded it) and its router coin. */
function braidDeposit(tx: BraidReadTx, address: string): BraidDeposit {
  const out: BraidDeposit = {};
  const index = routerCoinIndex(tx);
  const o = index === undefined ? undefined : tx.outputs![index];
  const amount = sompi(o?.amount);
  if (index !== undefined && o?.script_public_key_address && amount !== null)
    out.coin = {
      index,
      address: o.script_public_key_address,
      amountSompi: amount,
    };
  let fee = 0n;
  for (const i of tx.inputs ?? []) {
    const a = sompi(i?.previous_outpoint_amount);
    if (
      a === null ||
      (!covenantOf(i) && i.previous_outpoint_address !== address)
    )
      return out;
    fee += a;
  }
  for (const o of tx.outputs ?? []) {
    const a = sompi(o?.amount);
    if (a === null) return out;
    fee -= a;
  }
  if (tx.inputs?.length && fee >= 0n) out.networkFeeSompi = fee;
  return out;
}

/**
 * Txids to ask fetchBraidTxids about: every chain buy (Braid settles a buy at
 * another venue's market, which kascov names) and every pending Braid sell,
 * newest KCC20_SWAP_MONEY_LIMIT, one per transaction.
 */
export function braidCandidateTxids(
  swaps: readonly SwapActivityRecord[],
  braidSells: readonly SwapActivityRecord[],
): string[] {
  const rows = [...swaps.filter((s) => s.fromSymbol === "KAS"), ...braidSells]
    .filter((s) => s.txHash)
    .sort((a, b) => b.timestampMs - a.timestampMs);
  return [...new Set(rows.map((s) => s.txHash!))].slice(
    0,
    KCC20_SWAP_MONEY_LIMIT,
  );
}

/** Input `i` spends `parent`'s router coin (routerCoinIndex). */
function spendsRouterCoin(parent: BraidReadTx, i: MoneyTxInput): boolean {
  if (!isBraidDeposit(parent)) return false;
  const index = Number(i.previous_outpoint_index);
  const o = parent.outputs?.[index];
  return (
    routerCoinIndex(parent) === index &&
    o?.script_public_key_address === i.previous_outpoint_address &&
    o?.amount === i.previous_outpoint_amount
  );
}

export interface BraidReadResult {
  /** The txids that are Braid trades. */
  braid: Set<string>;
  /** Txids whose transaction (or a parent) could not be read: unknown, not "not Braid". */
  unread: number;
  /** The sells' own deposits, by txid: what was read to name them, kept. */
  deposits: Map<string, BraidDeposit>;
}

/**
 * The txids among `txids` that are Braid trades, read from the transactions
 * themselves. A sell is a Braid deposit: its payload is BRT1. A buy spends a
 * deposit's router coin: a plain input not the wallet's spending the router
 * coin output of a deposit. A deposit's change is the wallet's own address
 * (or another depositor's), so a trade spending it (the KaspaRocket GUZA buy
 * spends two) is not Braid's. A read that fails is not cached and is counted
 * in `unread`. Never throws.
 */
export async function fetchBraidTxids(
  address: string,
  txids: readonly string[],
): Promise<BraidReadResult> {
  const out = new Set<string>();
  const deposits = new Map<string, BraidDeposit>();
  let unread = 0;
  await Promise.allSettled(
    txids.map(async (txid) => {
      const key = `${address}:${txid}`;
      let hit = braidByTx.get(key);
      if (hit === undefined) {
        const tx = await readTx(txid);
        if (!tx) return void unread++;
        let braid = isBraidDeposit(tx);
        const deposit = braid ? braidDeposit(tx, address) : undefined;
        const parents = new Map<string, MoneyTxInput[]>();
        for (const i of tx.inputs ?? []) {
          const id = i.previous_outpoint_hash;
          if (covenantOf(i) || i.previous_outpoint_address === address || !id)
            continue;
          parents.set(id, [...(parents.get(id) ?? []), i]);
        }
        for (const [id, spends] of parents) {
          if (braid) break;
          const parent = await readTx(id);
          if (!parent) return void unread++;
          braid = spends.some((i) => spendsRouterCoin(parent, i));
        }
        hit = { braid, ...(deposit ? { deposit } : {}) };
        braidByTx.set(key, hit);
      }
      if (hit.braid) out.add(txid);
      if (hit.deposit) deposits.set(txid, hit.deposit);
    }),
  );
  return { braid: out, unread, deposits };
}

// ─── Braid: how a sell settled, from its router coin's spender ───────────────

/** api.kaspa.org /addresses/{a}/full-transactions rows, the fields read. */
export interface BraidListedTx extends BraidReadTx {
  transaction_id?: string;
  is_accepted?: boolean;
}

/**
 * A Braid sell's outcome. `done`: the settle paid the wallet `kasSompi` and
 * took `settleFeeSompi`. `refunded`: the coin was spent and nothing was paid
 * for the token. `open`: nothing accepted spends the coin yet.
 */
export type BraidSellSettle =
  | { state: "done"; kasSompi: bigint; settleFeeSompi: bigint }
  | { state: "refunded" }
  | { state: "open" };

// One object, so an unchanged "open" re-read compares equal (sameSpots).
const OPEN: BraidSellSettle = { state: "open" };

/**
 * How a sell settled, from the transactions at its router coin's address.
 * The settle is the accepted transaction spending (deposit, coin index).
 *
 * Received is the trade's KAS alone, as a KRON sell's (deriveKcc20SwapMoney):
 * the wallet's plain outputs in the settle, less the router coin the wallet
 * put in (it funds the settle fee and comes back as change), less the note
 * bond the settle frees, less the deposit's own fee — so net of both network
 * fees, which the row shows together as its Network fee. On the live fixture
 * (89fea3… → 568d41…): 10.18004 − 1 − 0.5 − 0.018264 = 8.661776 KAS.
 *
 * Null — no guess — when a plain input other than the coin is not the
 * wallet's (Braid batched another party's coin: the fee is not ours alone),
 * the settle spans more than one token/market pair, the outputs exceed the
 * inputs, or the deposit fee is unknown.
 */
export function deriveBraidSellSettle(
  listed: readonly BraidListedTx[],
  depositTxid: string,
  deposit: BraidDeposit,
  address: string,
): BraidSellSettle | null {
  const coin = deposit.coin;
  if (!coin || deposit.networkFeeSompi === undefined) return null;
  const spendsCoin = (i: MoneyTxInput) =>
    i.previous_outpoint_hash === depositTxid &&
    Number(i.previous_outpoint_index) === coin.index;
  const settle = listed.find(
    (t) => t.is_accepted === true && t.inputs?.some(spendsCoin),
  );
  if (!settle) return OPEN;
  let inputs = 0n;
  let walletIn = 0n;
  for (const i of settle.inputs ?? []) {
    const a = sompi(i?.previous_outpoint_amount);
    if (a === null) return null;
    inputs += a;
    if (covenantOf(i) || spendsCoin(i)) continue;
    if (i.previous_outpoint_address !== address) return null;
    walletIn += a;
  }
  let outputs = 0n;
  let walletOut = 0n;
  for (const o of settle.outputs ?? []) {
    const a = sompi(o?.amount);
    if (a === null) return null;
    outputs += a;
    if (!covenantOf(o) && o.script_public_key_address === address)
      walletOut += a;
  }
  const settleFee = inputs - outputs;
  const { bond, covenants } = covenantBond(settle);
  if (settleFee < 0n || covenants > 2) return null;
  const kas =
    walletOut - walletIn - coin.amountSompi + bond - deposit.networkFeeSompi;
  // ponytail: "no proceeds" stands for the refund shape (the coin spent, the
  // token handed back); a settle that pays less than both fees reads as one.
  if (kas <= 0n) return { state: "refunded" };
  return { state: "done", kasSompi: kas, settleFeeSompi: settleFee };
}

/** Final outcomes (done, refunded) per address and deposit txid; `open` is re-read. */
const braidSettleByTx = new Map<string, BraidSellSettle>();

/** Newest transactions at a router coin's address: its deposit and its settle. */
const BRAID_COIN_LISTING_LIMIT = 10;

/**
 * One request per sell: the router coin address's listing carries the settle
 * whole, so nothing else is read. A sell whose listing fails or will not
 * derive is left out of the map. Never throws.
 */
export async function fetchBraidSellSettles(
  address: string,
  deposits: ReadonlyMap<string, BraidDeposit>,
): Promise<Map<string, BraidSellSettle>> {
  const out = new Map<string, BraidSellSettle>();
  const base = KASPA_REST_APIS[NetworkType.Mainnet];
  await Promise.allSettled(
    [...deposits].map(async ([txid, deposit]) => {
      const key = `${address}:${txid}`;
      const hit = braidSettleByTx.get(key);
      if (hit) return void out.set(txid, hit);
      if (!deposit.coin) return;
      const listed = await requestJson(
        `${base}/addresses/${encodeURIComponent(deposit.coin.address)}` +
          `/full-transactions?resolve_previous_outpoints=light&limit=${BRAID_COIN_LISTING_LIMIT}`,
      );
      if (!Array.isArray(listed)) return;
      const settle = deriveBraidSellSettle(
        listed as BraidListedTx[],
        txid,
        deposit,
        address,
      );
      if (!settle) return;
      if (settle.state !== "open") braidSettleByTx.set(key, settle);
      out.set(txid, settle);
    }),
  );
  return out;
}

/**
 * The chain rows with Braid's trades attributed: a buy Braid settled names
 * Braid instead of the market it filled at, and a Braid sell joins the rows
 * once its deposit is confirmed. A row a pending Braid record already shows
 * (same deposit txid) is left to that record, which knows the settle state.
 */
export function applyBraidTxids(
  swaps: readonly SwapActivityRecord[],
  braidSells: readonly SwapActivityRecord[],
  braid: ReadonlySet<string>,
  pending: readonly SwapActivityRecord[] = [],
  deposits: ReadonlyMap<string, BraidDeposit> = new Map(),
  settles: ReadonlyMap<string, BraidSellSettle> = new Map(),
): SwapActivityRecord[] {
  const shown = new Set(pending.map((p) => p.txHash));
  return [
    ...swaps.map((s) =>
      s.fromSymbol === "KAS" && s.txHash && braid.has(s.txHash)
        ? { ...s, providerId: BRAID_PROVIDER.id }
        : s,
    ),
    ...braidSells
      .filter((s) => s.txHash && braid.has(s.txHash))
      .map((s): SwapActivityRecord => {
        // The deposit's own fee: read already, so the row never dashes it.
        const fee = deposits.get(s.txHash!)?.networkFeeSompi;
        const row =
          fee === undefined
            ? s
            : {
                ...s,
                feeAmount: formatUnits(fee, KAS_DECIMALS),
                feeSymbol: "KAS",
              };
        const settle = settles.get(s.txHash!);
        // kascov's refund (the token handed back) outranks any read.
        if (!settle || s.status === "failed") return row;
        if (settle.state === "open") return { ...row, status: "pending" };
        if (settle.state === "refunded") return { ...row, status: "failed" };
        return {
          ...row,
          toAmount: formatUnits(settle.kasSompi, KAS_DECIMALS),
          status: "completed",
          // Both network fees the trade paid: the deposit's and the settle's.
          ...(fee === undefined
            ? {}
            : {
                feeAmount: formatUnits(
                  fee + settle.settleFeeSompi,
                  KAS_DECIMALS,
                ),
                feeSymbol: "KAS",
              }),
        };
      }),
  ].filter((s) => !s.txHash || !shown.has(s.txHash));
}

// ─── Braid: the wallet's own deposit ─────────────────────────────────────────

// A plain address's script: P2PK, Schnorr (x-only key) or ECDSA (compressed).
const P2PK_SCRIPT = /^(20[0-9a-f]{64}ac|21[0-9a-f]{66}ab)$/;

/** The Schnorr P2PK script of an x-only key: the wallet's plain address. */
export const braidWalletScript = (xOnlyPk: string) =>
  `20${xOnlyPk.toLowerCase()}ac`;

/** Sompi, read from the deposit transaction the wallet signed. */
export interface BraidDepositMoney {
  /** inputs − outputs. Goes in feeAmount. */
  networkFeeSompi: bigint;
  /** Outputs to plain addresses other than the wallet. Goes in kastleFeeAmount. */
  venueFeeSompi: bigint;
}

/**
 * Both fees of a Braid deposit, from its own transaction. The deposit goes
 * to Braid's router script and token notes carry a covenant: neither is a
 * plain address, so neither is a fee. Null when a plain input is not the
 * wallet's (its outputs may then be that party's change) or the outputs
 * exceed the inputs: no guess.
 */
export function deriveBraidDepositMoney(
  tx: Tx,
  walletScript: string,
): BraidDepositMoney | null {
  if (!tx.inputs.length || !tx.outputs.length) return null;
  const wallet = walletScript.toLowerCase();
  let inputs = 0n;
  for (const i of tx.inputs) {
    if (!i.utxo) return null;
    const script = i.utxo.scriptPublicKey.toLowerCase();
    if (P2PK_SCRIPT.test(script) && script !== wallet) return null;
    inputs += i.utxo.amount;
  }
  let outputs = 0n;
  let venue = 0n;
  for (const o of tx.outputs) {
    outputs += o.value;
    const script = o.scriptPublicKey.toLowerCase();
    if (!o.covenant && P2PK_SCRIPT.test(script) && script !== wallet)
      venue += o.value;
  }
  const networkFee = inputs - outputs;
  if (networkFee < 0n) return null;
  return { networkFeeSompi: networkFee, venueFeeSompi: venue };
}

/** A Braid deposit the wallet sent, and how it settled. */
export interface BraidTradeInput {
  ref: string;
  depositTxid: string;
  startedAt: number;
  side: "buy" | "sell";
  /** The token leg's covenant id. */
  tokenId: string;
  tokenSymbol: string;
  /** Undefined when no source gives it: the token leg keeps its sentinel. */
  tokenDecimals?: number;
  /** Buy: the sompi paid in (payTotal). Sell: the token base units sold. */
  amountIn: bigint;
  /** The chain-verified delivery in the out leg's base units. */
  amountOut?: bigint;
  /** Undefined while the deposit is in flight. */
  state?: BraidSettleState;
  money: BraidDepositMoney | null;
}

/**
 * A Braid trade as a swap row. "pending" while in flight, and while the
 * outcome is unconfirmed: the row claims neither a delivery nor a loss the
 * chain did not show. The network fee and the venue fee keep their own
 * fields; providerId names Braid, as kascov's market names a KRON row's venue.
 */
export function braidSwapRecord(t: BraidTradeInput): SwapActivityRecord {
  const buy = t.side === "buy";
  // A token leg with no decimals is the unobserved-leg sentinel, never base units.
  const fmt = (v: bigint, kas: boolean) =>
    kas
      ? formatUnits(v, KAS_DECIMALS)
      : t.tokenDecimals === undefined
        ? "0"
        : formatUnits(v, t.tokenDecimals);
  const amountIn = fmt(t.amountIn, buy);
  // The out leg: the unobserved-leg sentinel until the chain shows it.
  const amountOut =
    t.state === "done" && t.amountOut !== undefined && t.amountOut > 0n
      ? fmt(t.amountOut, !buy)
      : "0";
  const status: SwapActivityRecord["status"] =
    t.state === "done"
      ? "completed"
      : t.state === undefined || t.state === "unconfirmed"
        ? "pending"
        : "failed";
  return {
    id: `braid:${t.ref}`,
    timestampMs: t.startedAt,
    fromSymbol: buy ? "KAS" : t.tokenSymbol,
    toSymbol: buy ? t.tokenSymbol : "KAS",
    fromAmount: amountIn,
    toAmount: amountOut,
    status,
    txHash: t.depositTxid,
    providerId: BRAID_PROVIDER.id,
    chainId: KAT_L1_CHAIN_ID,
    tokenId: t.tokenId.toLowerCase(),
    ...(t.money
      ? {
          feeAmount: formatUnits(t.money.networkFeeSompi, KAS_DECIMALS),
          feeSymbol: "KAS",
          ...(t.money.venueFeeSompi > 0n
            ? {
                kastleFeeAmount: formatUnits(
                  t.money.venueFeeSompi,
                  KAS_DECIMALS,
                ),
                kastleFeeSymbol: "KAS",
              }
            : {}),
        }
      : {}),
  };
}

/**
 * The Braid deposits still in flight for the wallet's key, as swap rows. A
 * deposit for another key is left out; one in a token no source names or
 * scales still shows (UNKNOWN_TOKEN_SYMBOL, amount sentinel). One that fails
 * to map is skipped, never fatal to the rest.
 */
export function braidPendingRecords(
  swaps: readonly PendingBraidSwap[],
  xOnlyPk: string,
  tokens: ReadonlyMap<string, Kcc20SwapTokenMeta>,
): SwapActivityRecord[] {
  const pk = xOnlyPk.toLowerCase();
  const walletScript = braidWalletScript(pk);
  return swaps.flatMap((s) => {
    try {
      const p = s.prepared;
      if (p.userPublicKey.toLowerCase() !== pk) return [];
      // payTotal is set on a KAS-in deposit only.
      const buy = p.payTotal != null;
      const token = buy ? p.to : p.from;
      // Known settlement state outranks metadata: an unnamed or unscaled
      // token still shows its in-flight row, its amount the sentinel.
      const meta = tokens.get(token.id.toLowerCase());
      return [
        braidSwapRecord({
          ref: s.ref,
          depositTxid: p.depositTxid,
          startedAt: s.startedAt,
          side: buy ? "buy" : "sell",
          tokenId: token.id,
          tokenSymbol: meta?.symbol ?? UNKNOWN_TOKEN_SYMBOL,
          tokenDecimals: meta?.decimals,
          amountIn: BigInt(buy ? p.payTotal! : p.amountIn),
          money: deriveBraidDepositMoney(
            braidWalletJsonToTx(p.walletJson),
            walletScript,
          ),
        }),
      ];
    } catch {
      return [];
    }
  });
}
