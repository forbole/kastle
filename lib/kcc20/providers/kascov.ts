// kascov: discovery only. It says which standard token ids a wallet holds and
// where their cells are; every balance is re-proven against our node and decoder.
export const KASCOV_URL = "https://kascov.io/data/mainnet";

const TIMEOUT_MS = 10_000;
// kascov's cells endpoint has no offset or cursor (it ignores both), so the
// five-page cap is one request for five pages' worth of cells.
const CELL_PAGE = 100;
const MAX_CELL_PAGES = 5;

export type KascovHolding = {
  tokenId: string;
  // kascov's figure, never displayed: the row's amount comes from verified cells.
  balance: bigint;
  class?: string;
  status?: string;
  ownerSchemeName?: string;
  // Claimed, never registry-verified.
  claimedTicker?: string;
  claimedName?: string;
  claimedImage?: string;
  displayDecimals?: number;
  metadataSource?: string;
};

export type KascovCell = {
  outpoint: { transactionId: string; index: number };
  programHex: string;
  amount: bigint;
  owner: string;
  ownerScheme?: string;
  borrowScheme?: string;
  borrowGuard?: string;
  extensionCommitment: string;
};

type Opts = { signal?: AbortSignal };

const HEX32 = /^[0-9a-f]{64}$/;
const OWNER_TUPLE = /^[0-9a-f]{66}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const optString = (v: unknown) => (typeof v === "string" ? v : undefined);

const lowerHex = (v: unknown) =>
  typeof v === "string" ? v.toLowerCase() : undefined;

/** A base-unit amount, `_str` twin first; undefined when neither is an exact non-negative integer. */
function baseUnits(row: Record<string, unknown>, key: string) {
  const str = row[`${key}_str`];
  if (typeof str === "string")
    return /^\d+$/.test(str) ? BigInt(str) : undefined;
  const num = row[key];
  return typeof num === "number" && Number.isSafeInteger(num) && num >= 0
    ? BigInt(num)
    : undefined;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status !== 200) throw new Error(`kascov ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function parseHolding(row: unknown): KascovHolding | undefined {
  if (!isRecord(row)) return undefined;
  const tokenId = lowerHex(row.token_id);
  const balance = baseUnits(row, "balance");
  if (!tokenId || !HEX32.test(tokenId) || balance === undefined)
    return undefined;
  // A declared row carries `claimed_*`, a listed one `listed_*` (as mobile);
  // `??`, not `||`: 0 decimals is real.
  const decimals = row.claimed_decimals ?? row.listed_decimals;
  return {
    tokenId,
    balance,
    class: optString(row.class),
    status: optString(row.status),
    ownerSchemeName: optString(row.owner_scheme_name),
    claimedTicker: optString(row.claimed_ticker ?? row.listed_ticker),
    claimedName: optString(row.claimed_name ?? row.listed_name),
    claimedImage: optString(row.claimed_image),
    displayDecimals:
      typeof decimals === "number" &&
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= 18
        ? decimals
        : undefined,
    metadataSource: optString(row.metadata_source),
  };
}

function parseCell(row: unknown): KascovCell | undefined {
  if (!isRecord(row)) return undefined;
  const [transactionId, indexStr, ...rest] =
    lowerHex(row.outpoint)?.split(":") ?? [];
  const programHex = lowerHex(row.program_hex);
  const owner = lowerHex(row.owner);
  const extensionCommitment = lowerHex(row.extension_commitment);
  const amount = baseUnits(row, "amount");
  if (
    rest.length > 0 ||
    !transactionId ||
    !HEX32.test(transactionId) ||
    !/^\d+$/.test(indexStr ?? "") ||
    !programHex ||
    !/^(?:[0-9a-f]{2})+$/.test(programHex) ||
    !owner ||
    !OWNER_TUPLE.test(owner) ||
    !extensionCommitment ||
    !HEX32.test(extensionCommitment) ||
    amount === undefined
  ) {
    return undefined;
  }
  const index = Number(indexStr);
  if (!Number.isSafeInteger(index)) return undefined;
  return {
    outpoint: { transactionId, index },
    programHex,
    amount,
    owner,
    ownerScheme: lowerHex(row.owner_scheme),
    borrowScheme: lowerHex(row.borrow_scheme),
    borrowGuard: lowerHex(row.borrow_guard),
    extensionCommitment,
  };
}

const parseRows = <T>(rows: unknown, parse: (row: unknown) => T | undefined) =>
  (rows as unknown[]).flatMap((row) => {
    const parsed = parse(row);
    return parsed ? [parsed] : [];
  });

async function getHoldingsDoc(address: string, signal?: AbortSignal) {
  const body = await getJson(
    `${KASCOV_URL}/addr/${encodeURIComponent(address)}.json`,
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body.token_holdings))
    throw new Error("kascov: malformed holdings response");
  return body;
}

/** Every standard holding kascov reports for `address`; drops only malformed rows. */
export async function fetchStandardHoldings(
  address: string,
  { signal }: Opts = {},
): Promise<KascovHolding[]> {
  const body = await getHoldingsDoc(address, signal);
  return parseRows(body.token_holdings, parseHolding);
}

/**
 * kascov's cells of `tokenId` owned by `ownerTupleHex` (identifier_type byte || 32-byte owner),
 * at most `limit`; `truncated` when kascov held back more.
 */
export async function fetchOwnerCells(
  tokenId: string,
  ownerTupleHex: string,
  {
    signal,
    limit = CELL_PAGE * MAX_CELL_PAGES,
  }: Opts & { limit?: number } = {},
): Promise<{ cells: KascovCell[]; truncated: boolean }> {
  if (!HEX32.test(tokenId) || !OWNER_TUPLE.test(ownerTupleHex))
    throw new Error("kascov: malformed token id or owner tuple");
  const body = await getJson(
    `${KASCOV_URL}/token/${tokenId}/cells?owner=${ownerTupleHex}&limit=${limit}`,
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body.cells))
    throw new Error("kascov: malformed cells response");
  // kascov counts what the limit left out; without that count, a full page is assumed cut.
  const omitted = body.omitted_over_limit;
  const truncated =
    typeof omitted === "number" ? omitted > 0 : body.cells.length >= limit;
  return { cells: parseRows(body.cells, parseCell), truncated };
}

const TRANSFER_PAGE = 50;
const EVENT_PAGE = 100;
// A bare x-only key or a scheme-prefixed one (`presence:`, `p2pkh:`, `covenant:`, ...).
const OWNER = /^(?:[a-z0-9-]+:)?[0-9a-f]{64}$/;
// What /transfers accepts as a filter; it answers 400 to any other prefix, `p2pkh:` included.
const OWNER_FILTER = /^(?:(?:presence|script|covenant):)?[0-9a-f]{64}$/;
const DECIMAL = /^\d+$/;

const isSeq = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const optOwner = (v: unknown) => {
  const owner = lowerHex(v);
  return owner && OWNER.test(owner) ? owner : undefined;
};

/** One payment kascov could attribute to a single source owner. */
export type KascovMovement = {
  amount: bigint;
  ownerFrom: string;
  ownerTo: string;
};

/**
 * One token state transition touching the queried owner. Its deltas are left out on purpose:
 * kascov says they are not amounts that may be summed as payments, so nothing here can read them.
 */
export type KascovTransfer = {
  txid: string;
  seq: number;
  txIndex: number;
  tokenId: string;
  acceptingDaa: number;
  kind: "transfer" | "split" | "merge";
  // "exact" carries movements; "ambiguous" (multi-owner merge) and "self" carry none.
  status: string;
  ownerFrom?: string;
  movements: KascovMovement[];
  marketId?: string;
  // kascov's name for the market's program, e.g. "KRON curve v2".
  marketBuild?: string;
  // kascov's own trade label, present on curve trades.
  marketSide?: "buy" | "sell";
};

// Pass all three back together; any one alone pages wrong.
export type KascovTransferCursor = {
  beforeDaa: number;
  beforeSeq: number;
  beforeToken: string;
};

/** One delta of a token's event log; `ownerFrom` is absent on mints. */
export type KascovTokenEvent = {
  txid: string;
  seq: number;
  deltaIdx: number;
  acceptingDaa: number;
  ownerFrom?: string;
  ownerTo: string;
  amount: bigint;
};

function parseMovement(m: unknown): KascovMovement | undefined {
  if (!isRecord(m) || typeof m.amount !== "string" || !DECIMAL.test(m.amount))
    return undefined;
  const ownerFrom = optOwner(m.owner_from);
  const ownerTo = optOwner(m.owner_to);
  if (!ownerFrom || !ownerTo) return undefined;
  return { amount: BigInt(m.amount), ownerFrom, ownerTo };
}

function parseTransfer(row: unknown): KascovTransfer | undefined {
  if (!isRecord(row) || !isRecord(row.attribution)) return undefined;
  const txid = lowerHex(row.txid);
  const tokenId = lowerHex(row.token_id);
  const { kind, seq, tx_index: txIndex, accepting_daa: acceptingDaa } = row;
  const { status, movements: rawMovements } = row.attribution;
  if (
    !txid ||
    !HEX32.test(txid) ||
    !tokenId ||
    !HEX32.test(tokenId) ||
    (kind !== "transfer" && kind !== "split" && kind !== "merge") ||
    !isSeq(seq) ||
    !isSeq(txIndex) ||
    !isSeq(acceptingDaa) ||
    typeof status !== "string" ||
    !Array.isArray(rawMovements)
  ) {
    return undefined;
  }
  // One malformed movement drops the row: a partial sum would be a wrong amount.
  const movements: KascovMovement[] = [];
  for (const raw of rawMovements) {
    const m = parseMovement(raw);
    if (!m) return undefined;
    movements.push(m);
  }
  const market = isRecord(row.verified_market) ? row.verified_market : {};
  const activity = isRecord(row.market_activity) ? row.market_activity : {};
  const marketId = lowerHex(market.market_id);
  return {
    txid,
    seq,
    txIndex,
    tokenId,
    acceptingDaa,
    kind,
    status,
    ownerFrom: optOwner(row.attribution.owner_from),
    movements,
    marketId: marketId && HEX32.test(marketId) ? marketId : undefined,
    marketBuild: optString(market.build),
    marketSide:
      activity.side === "buy" || activity.side === "sell"
        ? activity.side
        : undefined,
  };
}

function parseEvent(row: unknown): KascovTokenEvent | undefined {
  if (!isRecord(row)) return undefined;
  const txid = lowerHex(row.txid);
  const ownerTo = optOwner(row.owner_to);
  const amount = baseUnits(row, "amount");
  const { seq, delta_idx: deltaIdx, accepting_daa: acceptingDaa } = row;
  if (
    !txid ||
    !HEX32.test(txid) ||
    !ownerTo ||
    amount === undefined ||
    !isSeq(seq) ||
    !isSeq(deltaIdx) ||
    !isSeq(acceptingDaa) ||
    (row.owner_from !== undefined && !optOwner(row.owner_from))
  ) {
    return undefined;
  }
  return {
    txid,
    seq,
    deltaIdx,
    acceptingDaa,
    ownerFrom: optOwner(row.owner_from),
    ownerTo,
    amount,
  };
}

/** The `next_before_*` trio, or undefined on the last page; a partial trio is malformed. */
function parseTransferCursor(
  body: Record<string, unknown>,
): KascovTransferCursor | undefined {
  const {
    next_before_daa: beforeDaa,
    next_before_seq: beforeSeq,
    next_before_token: rawToken,
  } = body;
  if (
    beforeDaa === undefined &&
    beforeSeq === undefined &&
    rawToken === undefined
  )
    return undefined;
  const beforeToken = lowerHex(rawToken);
  if (
    !isSeq(beforeDaa) ||
    !isSeq(beforeSeq) ||
    !beforeToken ||
    !HEX32.test(beforeToken)
  )
    throw new Error("kascov: malformed transfers cursor");
  return { beforeDaa, beforeSeq, beforeToken };
}

/** `owner`'s transitions of `tokenId`, newest first; `next` pages back when kascov has more. */
export async function fetchOwnerTransfers(
  owner: string,
  tokenId: string,
  cursor?: KascovTransferCursor,
  { signal }: Opts = {},
): Promise<{ transfers: KascovTransfer[]; next?: KascovTransferCursor }> {
  if (!HEX32.test(tokenId))
    throw new Error("kascov: malformed owner or token id");
  return transfersPage(owner, `&token_id=${tokenId}`, cursor, signal);
}

/**
 * `owner`'s transitions of every verified-market token, newest first. Without `token_id`
 * kascov answers across tokens and the cursor's `before_token` names where to resume.
 */
export async function fetchOwnerMarketTransfers(
  owner: string,
  cursor?: KascovTransferCursor,
  { signal }: Opts = {},
): Promise<{ transfers: KascovTransfer[]; next?: KascovTransferCursor }> {
  return transfersPage(owner, "", cursor, signal);
}

async function transfersPage(
  owner: string,
  tokenFilter: string,
  cursor: KascovTransferCursor | undefined,
  signal: AbortSignal | undefined,
): Promise<{ transfers: KascovTransfer[]; next?: KascovTransferCursor }> {
  if (!OWNER_FILTER.test(owner))
    throw new Error("kascov: malformed owner or token id");
  if (cursor && !HEX32.test(cursor.beforeToken))
    throw new Error("kascov: malformed transfers cursor");
  const page = cursor
    ? `&before_daa=${cursor.beforeDaa}&before_seq=${cursor.beforeSeq}&before_token=${cursor.beforeToken}`
    : "";
  const body = await getJson(
    `${KASCOV_URL}/transfers?owner=${encodeURIComponent(owner)}${tokenFilter}&limit=${TRANSFER_PAGE}${page}`,
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body.transfers))
    throw new Error("kascov: malformed transfers response");
  const next = parseTransferCursor(body);
  return {
    transfers: parseRows(body.transfers, parseTransfer),
    ...(next && { next }),
  };
}

/**
 * Every owner's deltas of `tokenId`, newest first; no owner filter. `nextBeforeSeq` pages back.
 * For tokens `/transfers` misses, and only small ones: some tokens carry thousands of events.
 */
export async function fetchTokenEvents(
  tokenId: string,
  beforeSeq?: number,
  { signal }: Opts = {},
): Promise<{
  events: KascovTokenEvent[];
  eventsTotal?: number;
  nextBeforeSeq?: number;
}> {
  if (!HEX32.test(tokenId) || (beforeSeq !== undefined && !isSeq(beforeSeq)))
    throw new Error("kascov: malformed token id or cursor");
  const page = beforeSeq === undefined ? "" : `&before_seq=${beforeSeq}`;
  const body = await getJson(
    `${KASCOV_URL}/token/${tokenId}/events?order=desc&limit=${EVENT_PAGE}${page}`,
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body.events))
    throw new Error("kascov: malformed events response");
  const { events_total: eventsTotal, next_before_seq: nextBeforeSeq } = body;
  if (nextBeforeSeq !== undefined && !isSeq(nextBeforeSeq))
    throw new Error("kascov: malformed events cursor");
  return {
    events: parseRows(body.events, parseEvent),
    ...(isSeq(eventsTotal) && { eventsTotal }),
    ...(nextBeforeSeq !== undefined && { nextBeforeSeq }),
  };
}

/**
 * The holdings of `address` with the DAA tip kascov read them at (`tip_daa`, `tip_at_ms`),
 * the anchor history rows date themselves from. A missing or malformed tip throws.
 */
export async function fetchStandardHoldingsWithTip(
  address: string,
  { signal }: Opts = {},
): Promise<{ holdings: KascovHolding[]; tip: { daa: number; atMs: number } }> {
  const body = await getHoldingsDoc(address, signal);
  const { tip_daa: daa, tip_at_ms: atMs } = body;
  if (!isSeq(daa) || !isSeq(atMs))
    throw new Error("kascov: malformed holdings tip");
  return {
    holdings: parseRows(body.token_holdings, parseHolding),
    tip: { daa, atMs },
  };
}

const spotPart = (v: unknown) => {
  const n = typeof v === "string" && DECIMAL.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * KAS per whole token from kascov's market for a standard token, before the 1% fee;
 * null when kascov has no market for it (404) or its spot is missing. Other failures throw.
 */
export async function fetchStandardMarketPrice(
  tokenId: string,
  decimals: number,
  { signal }: Opts = {},
): Promise<number | null> {
  if (!HEX32.test(tokenId)) throw new Error("kascov: malformed token id");
  let body: unknown;
  try {
    body = await getJson(`${KASCOV_URL}/token/${tokenId}/market`, signal);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("kascov 404 ")) return null;
    throw e;
  }
  const market = isRecord(body) && isRecord(body.market) ? body.market : {};
  const num = spotPart(market.spot_num_sompi);
  const den = spotPart(market.spot_den);
  if (num === undefined || den === undefined) return null;
  // kascov's spot is sompi per base unit, as kronCurvePriceKas's sompiPerUnit.
  return ((num / den) * 10 ** decimals) / 1e8;
}
