// Igra KAS → iKAS deposits, reconstructed from Kaspa L1.
//
// This route is NOT operated by KAT: hooks/bridge/useKasToIgraBridge.ts pays
// Igra's lane entry address on L1 with a 33-byte payload, and Igra credits the
// destination EVM account at block level. It therefore appears in neither
// source the feed already reads:
//   - KAT's /bridge-history indexes KAT's own routes only (verified live: every
//     address of a wallet with 11 such deposits returns zero rows);
//   - the mint has NO L2 transaction — it is a txhash-less balance credit, so
//     no L2 transaction list can see it either. It is not invisible, though:
//     Blockscout records it as a beacon-chain withdrawal, readable at
//     /api/v2/addresses/{addr}/withdrawals.
//
// Nothing on device ever recorded these, which is why they were invisible.
// The L1 payment is fully self-describing, so no registry and no local write is
// needed: the history is recoverable from chain data alone, retroactively and
// after a seed import.
//
// Payload layout, mirroring the hook that builds it:
//   [0x92][20B destination EVM address][8B little-endian sompi][4B lane nonce]
// The sompi field is the amount that reaches Igra — Kastle's own fee
// (KASTLE_FEE_ADDRESS) is a separate output of the SAME transaction, so the
// user's real outlay and Kastle's cut are both observable here and neither is
// ever computed from a rate. That matters because no single rate fits. Of the
// 32 deposits surveyed on 2026-08-27 across the two mainnet test wallets, 21
// carry the 0.2 KAS + 0.75% of gross the constants describe, 1 carries exactly
// 0.75% of gross with no base (97b116cc8c, 0.75 KAS on a gross 100), and 10
// carry no Kastle output at all. Today's constants would misprice 11.
//
// Do NOT re-explain those 11 by date — two versions of that story have already
// been written here and the chain supports neither. They do not simply predate
// the fee: only six of the ten uncharged deposits fall before the first charged
// one. Three land on 2026-06-11 and one on 2026-06-23, between a deposit
// charged 0.2 + 0.75% on 2026-05-28 and another charged the same way on
// 2026-06-18 — and on 2026-06-11 the same wallet paid a 0.275 KAS cut to
// KASTLE_FEE_ADDRESS at 02:39:26 (6cb726a1b033), then made three Igra deposits
// at 03:52, 08:28 and 08:35 with no cut at all. Nor is the 0.75% one from a
// "no base" era: 0.2 has been KASTLE_BASE_FEE since the fee code first landed
// (d6af19f, 2026-05-27) and that deposit postdates it by a day.
//
// Which client built which transaction is not recorded on chain. The only claim
// the chain supports is the one this file makes: the output is absent.

import { NetworkType } from "@/contexts/SettingsContext";
import { KASPA_REST_APIS, KASTLE_FEE_ADDRESS } from "@/lib/activity/externals";
import type { IgraCreditObservation } from "@/lib/bridge/igra-credits";

/** Total payload length in hex characters: 1 + 20 + 8 + 4 bytes. */
const PAYLOAD_HEX_LEN = 66;
const PAYLOAD_PREFIX = "92";

export interface IgraDeposit {
  /** L1 transaction id — unique, and the row's Source TX. */
  txId: string;
  /** Destination EVM address from the payload, lowercase. */
  evmAddress: string;
  /** Payload amount, in sompi — what the lane is asked to credit on Igra. */
  amountSompi: number;
  /**
   * Observed L1 output to the lane entry address, in sompi. Equal to
   * amountSompi on every mainnet deposit surveyed (2026-08-26); kept
   * separate because it is the OBSERVED figure and amountSompi is the
   * payload's claim about it, and a provider cut would show up as the gap.
   */
  entryOutSompi: number;
  /**
   * Observed L1 output to KASTLE_FEE_ADDRESS, in sompi. A real 0 (the deposit
   * predates the fee, or the sender was not Kastle) is different from "not
   * derivable" — this field is only ever the observed sum, never a rate.
   */
  kastleFeeSompi: number;
  timestampMs: number;
  /**
   * L1 acceptance — the lane being PAID, which is not the same as the credit
   * landing. A deposit can be accepted here and never credited on L2
   * (97b13711f9126c4e… is one), so this alone never completes a row: that
   * takes `credit`.
   */
  accepted: boolean;
  /**
   * Igra's own record of the credit (lib/bridge/igra-credits.ts). Absent when
   * the credit list could not be read, or the deposit is not accepted yet.
   */
  credit?: IgraCreditObservation;
}

/**
 * Non-fatal states worth telling the user about. These are NOT the same
 * failure: `unavailable` means the list is empty because L1 could not be read,
 * `partial` means the list has real rows but stops at the scan horizon, so
 * older deposits may be missing. Rendering one as the other would either hide
 * real money or claim money is missing when it is not.
 */
export type IgraDepositDegradation =
  | "igra_deposits_unavailable"
  | "igra_deposits_partial";

/** Outcome of a scan. `truncated` is only meaningful when `ok`. */
export interface IgraDepositResult {
  deposits: IgraDeposit[];
  /** false = L1 could not be read. Distinct from "read fine, nothing there". */
  ok: boolean;
  /**
   * true = the scan stopped at MAX_PAGES with history left unread, so
   * `deposits` is the newest slice of the truth rather than the truth. Callers
   * MUST NOT present this as a complete history.
   */
  truncated: boolean;
}

const PAGE_SIZE = 100;
// How far back one scan reads, in pages of PAGE_SIZE transactions.
//
// This is a horizon, not a promise, and the gap is not small. Paging the lane
// entry address exhaustively on 2026-08-20 found 1,175 depositors and 6,541
// deposits; 107 of those wallets hold more than 2,000 L1 transactions and 21%
// of all lane deposits sit behind them. Running this function against 25 of
// the deep ones, 9 came back short — 191 of their 1,101 deposits unread.
//
// So 20 pages is a cost ceiling, not a coverage guarantee. What the number is
// actually chosen against is the cold-scan bill: a page is 210-390 KB of JSON
// fetched and parsed on the JS thread, so 20 pages is ~4.8 MB, paid once and
// then amortised by the head refresh below. Raising it buys coverage linearly
// in bytes and never reaches "all wallets" — 41,874 transactions is a real
// wallet on this lane.
//
// What makes that acceptable is the flag, not the depth: every one of those 9
// short results reported `truncated: true`. A partial history is allowed here.
// A partial history served as complete is the bug this file exists to fix.
// No "load more" past the horizon — those deposits are unreachable
// by any user action. Add paging on demand when someone asks for their
// pre-horizon history.
//
// Cost is why there is a horizon at all: a page is 210-390 KB of JSON fetched
// and parsed on the JS thread, so 20 pages is ~4.8 MB on a cold scan. That is
// paid once and then amortised — see the head refresh below.
const MAX_PAGES = 20;

// Steady-state cost control.
//
// The feed polls every 10s. Re-running a deep scan on that cadence is what made
// the naive fix untenable: a 16-page wallet would pull ~3.8 MB per refresh.
//
// The fix is that a scan does not need repeating. Accepted deposits are
// immutable and L1 history only grows at the head, so once a wallet has been
// scanned, re-reading page 0 alone catches everything new — provided page 0
// still overlaps what we already hold. `newestTxId` is that continuity check:
// if it is gone from page 0, more than PAGE_SIZE transactions landed since the
// last look and the scan is redone from scratch.
//
// Net effect: steady-state cost is one page per refresh regardless of how deep
// the wallet is, i.e. exactly what a one-page wallet already paid before this
// file existed. Only a cold scan and the FULL_TTL_MS safety net pay for depth.
const HEAD_TTL_PENDING_MS = 10_000;
const HEAD_TTL_SETTLED_MS = 60_000;
// Backstop against an indexer that reorganises history under us. Continuity
// breaks force a rescan on their own, so this is deliberately long: repeating a
// truncated scan returns a byte-identical answer at full price.
const FULL_TTL_MS = 30 * 60_000;

interface CacheEntry {
  /** When the full scan ran. Governs FULL_TTL_MS. */
  scannedAt: number;
  /** When page 0 was last re-read. Governs the head TTLs. */
  headAt: number;
  /** Newest transaction id of the last read, or null if the wallet has none. */
  newestTxId: string | null;
  result: IgraDepositResult;
}

const cache = new Map<string, CacheEntry>();

/**
 * A truncated scan and a complete scan are different answers to the same
 * question, so they never share a cache slot: a partial history can never be
 * handed back through the key a complete one occupies, no matter what a future
 * caller forgets to check.
 */
function cacheKey(address: string, truncated: boolean): string {
  return `${truncated ? "partial" : "full"}:${address}`;
}

/** Addresses already warned about, so the log records a horizon, not a poll. */
const warnedTruncated = new Set<string>();

/** Test seam — a fresh process starts empty, so only tests need this. */
export function clearIgraDepositCache(): void {
  cache.clear();
  warnedTruncated.clear();
}

function remember(address: string, entry: CacheEntry): IgraDepositResult {
  // Exactly one slot per address. Writing the partial slot without clearing the
  // complete one leaves a stale entry that every later lookup finds first and
  // then discards on TTL, so the wallet is rescanned in full on every refresh
  // forever — the key split is only safe if the sibling is evicted.
  cache.delete(cacheKey(address, !entry.result.truncated));
  cache.set(cacheKey(address, entry.result.truncated), entry);
  return entry.result;
}

function headTtl(result: IgraDepositResult): number {
  return result.deposits.some((d) => !d.accepted)
    ? HEAD_TTL_PENDING_MS
    : HEAD_TTL_SETTLED_MS;
}

interface KaspaRestTx {
  transaction_id: string;
  accepting_block_time: number;
  is_accepted?: boolean;
  payload?: string | null;
  inputs?: Array<{ previous_outpoint_address?: string }>;
  outputs?: Array<{ script_public_key_address: string; amount: number }>;
}

/**
 * Decode a lane payload. Returns null for anything that is not one — ordinary
 * sends carry a "KSTL" marker, and Kurve deposits carry the EVM address as
 * ASCII, so a prefix check alone is not enough to claim a payment is a deposit.
 */
export function parseIgraEntryPayload(
  payload: string | null | undefined,
): { evmAddress: string; amountSompi: number } | null {
  if (!payload || payload.length !== PAYLOAD_HEX_LEN) return null;
  const hex = payload.toLowerCase();
  if (!hex.startsWith(PAYLOAD_PREFIX) || !/^[0-9a-f]+$/.test(hex)) return null;

  // 8 little-endian bytes: read back-to-front.
  const amountHex = hex.slice(42, 58);
  const bytes = amountHex.match(/.{2}/g);
  if (!bytes) return null;
  const amountSompi = Number(BigInt("0x" + [...bytes].reverse().join("")));
  if (!Number.isSafeInteger(amountSompi) || amountSompi <= 0) return null;

  return { evmAddress: `0x${hex.slice(2, 42)}`, amountSompi };
}

/**
 * Wall-clock bound for a single L1 read.
 *
 * Without one, a hung socket never settles and neither does the feed promise
 * built on it — which the activity screen surfaces as a pull-to-refresh
 * spinner that never stops. Matches the 10s used by kat-registry's requestJson.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * fetch() with a timeout. An abort rejects, which both callers already treat
 * as "unreadable" via their catch — a timed-out page is indistinguishable
 * from a failed one, and neither is cached.
 */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** One page of L1 history, or null if it could not be read. */
async function fetchPage(
  base: string,
  kaspaAddress: string,
  offset: number,
): Promise<KaspaRestTx[] | null> {
  try {
    const res = await fetchWithTimeout(
      `${base}/addresses/${encodeURIComponent(kaspaAddress)}/full-transactions` +
        `?resolve_previous_outpoints=light&limit=${PAGE_SIZE}` +
        `&offset=${offset}`,
    );
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    return body as KaspaRestTx[];
  } catch {
    return null;
  }
}

/**
 * Total transactions the indexer holds for the address, or null if unavailable.
 *
 * This counts index rows, which is an upper bound on distinct transactions —
 * measured live, one wallet reports 12,064 here and pages 12,063 unique ids.
 * An upper bound is exactly what is needed to rule truncation out: if it fits
 * inside the horizon, so does the real history.
 */
async function fetchTxCount(
  base: string,
  kaspaAddress: string,
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `${base}/addresses/${encodeURIComponent(kaspaAddress)}/transactions-count`,
    );
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const total = (body as { total?: unknown })?.total;
    return typeof total === "number" && Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/** Deposits in `txs` that belong to this wallet, in page order. */
function depositsIn(
  txs: KaspaRestTx[],
  kaspaAddress: string,
  entryAddress: string,
): IgraDeposit[] {
  const out: IgraDeposit[] = [];
  for (const tx of txs) {
    const parsed = parseIgraEntryPayload(tx.payload);
    if (!parsed) continue;
    // The payload alone proves nothing: require that this wallet funded the
    // transaction and that the entry address was actually paid, so a payload
    // copied into an unrelated payment cannot invent a deposit.
    const spentByUs = (tx.inputs ?? []).some(
      (i) => i.previous_outpoint_address === kaspaAddress,
    );
    // Sum, not find: nothing forbids a builder from splitting either payment
    // across outputs, and a `find` would silently under-report the user's
    // outlay if one ever did.
    const sumTo = (address: string): number =>
      (tx.outputs ?? []).reduce(
        (n, o) =>
          o.script_public_key_address === address ? n + (o.amount ?? 0) : n,
        0,
      );
    const entryOutSompi = sumTo(entryAddress);
    if (!spentByUs || entryOutSompi <= 0) continue;

    out.push({
      txId: tx.transaction_id,
      evmAddress: parsed.evmAddress,
      amountSompi: parsed.amountSompi,
      entryOutSompi,
      // A 0 here is a READ zero, not an unread one, and the guard above is what
      // makes that true: this line is only reached once entryOutSompi > 0, which
      // cannot happen unless tx.outputs exists and was summed. So the outputs
      // were examined and none of them pays KASTLE_FEE_ADDRESS. That is the
      // whole difference from kat-observed-fees.ts readDepositFees, which reads
      // a reveal with no such precondition and so has to return null instead.
      //
      // Surveyed on chain 2026-08-27, both test wallets: all ten deposits that
      // sum to 0 here pay Kastle nothing anywhere. Nine carry exactly two
      // outputs, the lane entry and change back to the sender. The tenth
      // (97b1ebbab6, 2026-03-20) has a third — 1.00000000 KAS to
      // kaspa:qqch24lhsn… — which is not ours: it appears nowhere in this
      // repo's history, it is paid by 11 of 95 lane deposits from a subset of
      // 29 senders in the 2026-03-04..03-19 window while KASTLE_FEE_ADDRESS is
      // paid by none of them, it sends its own deposits on this lane, and a
      // flat 1 KAS matches no Kastle schedule ever shipped.
      //
      // The one shape this cannot answer is a deposit that KASTLE_FEE_ADDRESS
      // itself co-funded, where its outputs would be change rather than a cut.
      // It is unreachable from here — spentByUs already requires the scanned
      // wallet among the inputs — so it is named rather than guarded.
      kastleFeeSompi: sumTo(KASTLE_FEE_ADDRESS[NetworkType.Mainnet]),
      timestampMs: tx.accepting_block_time,
      accepted: tx.is_accepted !== false,
    });
  }
  return out;
}

/**
 * Deposits this wallet sent to Igra's lane entry address, newest first.
 *
 * `ok: false` means L1 could not be read — distinct from a wallet that has
 * simply never bridged, which is `ok: true` with no deposits. Never throws.
 *
 * `truncated: true` means the wallet's history is deeper than MAX_PAGES and the
 * scan stopped early, so older deposits exist that are not in the list. Real
 * mainnet wallets sit past the horizon: the deepest surveyed has 424 deposits
 * worth 70,479 KAS across 12,063 transactions.
 */
export async function fetchIgraDeposits({
  kaspaAddress,
  entryAddress,
  force = false,
}: {
  kaspaAddress?: string | null;
  entryAddress: string;
  /**
   * Skip the head-TTL short-circuit so an explicit refresh (pull-to-refresh)
   * always re-checks L1 instead of serving a stale head. Still splices onto
   * the cached tail rather than paying the full cold-scan cost — a failed
   * read is never cached (see below), so a degraded source already retries
   * fully on its own; force only matters when the cache is healthy but
   * within TTL and the user wants a genuine re-check anyway.
   */
  force?: boolean;
}): Promise<IgraDepositResult> {
  if (!kaspaAddress) return { deposits: [], ok: true, truncated: false };

  const base = KASPA_REST_APIS[NetworkType.Mainnet];
  // At most one slot per address exists (remember() evicts the sibling), so
  // this cannot find a stale complete entry shadowing a fresh partial one.
  const hit =
    cache.get(cacheKey(kaspaAddress, false)) ??
    cache.get(cacheKey(kaspaAddress, true));

  if (hit) {
    const now = Date.now();
    if (!force && now - hit.headAt < headTtl(hit.result)) return hit.result;

    if (now - hit.scannedAt < FULL_TTL_MS) {
      const head = await fetchPage(base, kaspaAddress, 0);
      // A transient L1 failure must not throw away a good history: keep serving
      // what we have and try again on the next refresh.
      if (head === null) return hit.result;

      const overlaps =
        hit.newestTxId !== null &&
        head.some((tx) => tx.transaction_id === hit.newestTxId);
      // No overlap means more than PAGE_SIZE transactions landed since the last
      // look, so the head no longer reaches what we hold — fall through and
      // rescan rather than splice two lists that may have a gap between them.
      if (overlaps) {
        const fresh = depositsIn(head, kaspaAddress, entryAddress);
        const freshIds = new Set(fresh.map((d) => d.txId));
        // Page 0 is the newest transactions, so its deposits belong at the
        // front; its copies also carry the current acceptance state, which is
        // the other thing a head refresh is for.
        const merged = [
          ...fresh,
          ...hit.result.deposits.filter((d) => !freshIds.has(d.txId)),
        ];
        return remember(kaspaAddress, {
          scannedAt: hit.scannedAt,
          headAt: now,
          newestTxId: head[0]?.transaction_id ?? hit.newestTxId,
          result: { ...hit.result, deposits: merged },
        });
      }
    }
  }

  const deposits: IgraDeposit[] = [];
  const seenTxIds = new Set<string>();
  let newestTxId: string | null = null;
  let hitHorizon = true;

  for (let page = 0; page < MAX_PAGES; page++) {
    const txs = await fetchPage(base, kaspaAddress, page * PAGE_SIZE);
    if (txs === null) return { deposits, ok: false, truncated: false };

    // Only an empty page proves the end of the history. A SHORT page does not:
    // api.kaspa.org de-duplicates within a page, so it returns short pages in
    // the middle of a wallet's history — reproducibly, offset=800 gives 99 rows
    // for a wallet with 12,063 transactions. Treating that as the end silently
    // dropped 162 of its 424 deposits and reported the rest as complete.
    if (txs.length === 0) {
      hitHorizon = false;
      break;
    }

    // Because pages can be short, consecutive pages can overlap. Dedupe by
    // transaction id so an overlap cannot double-count a deposit.
    for (const tx of txs) {
      if (seenTxIds.has(tx.transaction_id)) continue;
      seenTxIds.add(tx.transaction_id);
      if (newestTxId === null) newestTxId = tx.transaction_id;
      deposits.push(...depositsIn([tx], kaspaAddress, entryAddress));
    }
  }

  // How much history exists, asked AFTER paging rather than before. It costs a
  // few bytes and is the only way to tell "stopped at the horizon" from "the
  // history happens to end on a page boundary" without spending a whole extra
  // page. Order matters: this number is what can clear the truncated flag, so
  // it must never be older than the scan. Read first, a wallet sitting just
  // under the horizon that receives transactions mid-scan would be measured
  // small, cleared, and served short as complete. Read last it can only be
  // equal or larger, which fails toward "partial" — the safe direction.
  const totalRows = await fetchTxCount(base, kaspaAddress);

  // Ran out of pages without reaching an empty one. That only means deposits
  // are missing if there is genuinely more history than the horizon covers —
  // a wallet ending exactly on the last page is complete, and must not be told
  // its history was too long to read.
  const truncated =
    hitHorizon && !(totalRows !== null && totalRows <= MAX_PAGES * PAGE_SIZE);

  if (truncated && !warnedTruncated.has(kaspaAddress)) {
    warnedTruncated.add(kaspaAddress);
    console.warn(
      `[igra-deposit-history] truncated at ${MAX_PAGES * PAGE_SIZE} L1 transactions`,
    );
  }

  return remember(kaspaAddress, {
    scannedAt: Date.now(),
    headAt: Date.now(),
    newestTxId,
    result: { deposits, ok: true, truncated },
  });
}
