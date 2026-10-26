// kascov: discovery only. It says which standard token ids a wallet holds and
// where their cells are; every balance is re-proven against our node and decoder.
export const KASCOV_URL = "https://kascov.io/data/mainnet";

const TIMEOUT_MS = 10_000;
const DEFAULT_CELL_LIMIT = 100;

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

function parseHolding(row: unknown): KascovHolding | undefined {
  if (!isRecord(row)) return undefined;
  const tokenId = lowerHex(row.token_id);
  const balance = baseUnits(row, "balance");
  if (!tokenId || !HEX32.test(tokenId) || balance === undefined)
    return undefined;
  const decimals = row.display_decimals;
  return {
    tokenId,
    balance,
    class: optString(row.class),
    status: optString(row.status),
    ownerSchemeName: optString(row.owner_scheme_name),
    claimedTicker: optString(row.claimed_ticker),
    claimedName: optString(row.claimed_name),
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

/** Every standard holding kascov reports for `address`; drops only malformed rows. */
export async function fetchStandardHoldings(
  address: string,
  { signal }: Opts = {},
): Promise<KascovHolding[]> {
  const body = await getJson(
    `${KASCOV_URL}/addr/${encodeURIComponent(address)}.json`,
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body.token_holdings))
    throw new Error("kascov: malformed holdings response");
  return parseRows(body.token_holdings, parseHolding);
}

/** kascov's cells of `tokenId` owned by `ownerTupleHex` (identifier_type byte || 32-byte owner). */
export async function fetchOwnerCells(
  tokenId: string,
  ownerTupleHex: string,
  { signal, limit = DEFAULT_CELL_LIMIT }: Opts & { limit?: number } = {},
): Promise<KascovCell[]> {
  if (!HEX32.test(tokenId) || !OWNER_TUPLE.test(ownerTupleHex))
    throw new Error("kascov: malformed token id or owner tuple");
  const body = await getJson(
    `${KASCOV_URL}/token/${tokenId}/cells?owner=${ownerTupleHex}&limit=${limit}`,
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body.cells))
    throw new Error("kascov: malformed cells response");
  return parseRows(body.cells, parseCell);
}
