import { client, covenantSelect, kcc20, verify } from "@kronsdk/kron-sdk";
import { bytesToHex, hexToBytes } from "viem";
import {
  addressFromScriptPublicKey,
  payToAddressScript,
  payToScriptHashScript,
  RpcClient,
} from "@/wasm/core/kaspa";
import { classifyRedeem, isStandardOwnedBy } from "./classify";
import { liveEntries } from "./live-entries";
import {
  fetchOwnerCells,
  fetchStandardHoldings,
  KascovHolding,
} from "./providers/kascov";
import { hash } from "./standard/primitives";
import type { KCC20State } from "./standard/state";
import { StandardPiece, verifyStandardCells } from "./standard/verify";

// Mainnet only — KRON publishes no testnet indexer or registry yet.
export const KRON_INDEXER_URL = "https://idx.kron.technology/v1/kcc20";
export const KRON_REGISTRY_URL = "https://api.kron.technology";

export type TokenListEntry = verify.SignedTokenList["tokens"][number];

// Which state family a row's pieces decode as; only kron-legacy has a send builder.
export type Kcc20Family = "kron-legacy" | "kcc20-standard";

export type Kcc20Token = {
  covenantId: string;
  family: Kcc20Family;
  // The indexer's route to this token's UTXOs; the send flow re-reads them with it.
  tick: string;
  // Base units, summed from UTXOs the node confirmed; never the indexer's figure.
  amount: bigint;
  // The ADDRESS-owned part of `amount`: the only pieces the send builder can spend.
  spendable: bigint;
  // Legacy: set only when the registry entry for this covenant id verified against its genesis tx.
  // Standard: kascov's claimed fields, always marked `unverified`.
  meta?: {
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    unverified?: true;
  };
  // Standard rows only (hex): with covenantId, the row's grouping key.
  extensionCommitment?: string;
};

/** Whether a decoded token state is spendable by the wallet whose scriptPublicKey is `walletSpk` (hex). */
export function isOwnedBy(state: kcc20.Kcc20State, walletSpk: string) {
  const owner = bytesToHex(state.ownerIdentifier).slice(2);
  switch (state.identifierType) {
    case kcc20.IDENTIFIER.PUBKEY:
    case kcc20.IDENTIFIER.ADDRESS:
      return walletSpk === `20${owner}ac`;
    case kcc20.IDENTIFIER.SCRIPT_HASH:
      return walletSpk === `aa20${owner}87`;
    default:
      // COVENANT_ID: held by a curve or pool, never by a wallet.
      return false;
  }
}

/** Only a non-zero verified balance of a token with verified metadata is shown. */
export function shouldIncludeToken(
  meta: Kcc20Token["meta"] | undefined,
  amount: bigint,
): boolean {
  return meta !== undefined && amount > 0n;
}

// The indexer supplies the redeem scripts, so it could claim any state. A
// piece counts only if the node holds that outpoint at P2SH(redeem) under the
// token's covenant id: consensus lets only the covenant (or its genesis)
// create such a UTXO, which binds the decoded amount to real lineage.
export type Kcc20Piece = {
  outpoint: { transactionId: string; index: number };
  state: kcc20.Kcc20State;
  redeem: Uint8Array;
  // Native KAS the node holds on this outpoint; never assumed, always read off the entry.
  value: bigint;
};

export { liveEntries };

export async function verifiedPieces(
  indexer: client.IndexerClient,
  rpc: RpcClient,
  tick: string,
  address: string,
  covid: string,
): Promise<Kcc20Piece[]> {
  return (await classifiedPieces(indexer, rpc, tick, address, covid)).legacy;
}

// The same node binding as Kcc20Piece, in the KCC-20 standard family.
// Read-only: this version neither counts nor spends one.
export type Kcc20StandardPiece = {
  outpoint: { transactionId: string; index: number };
  state: KCC20State;
  redeem: Uint8Array;
  value: bigint;
};

/** The wallet's node-verified pieces of `covid`, split by family; `legacy` is what verifiedPieces returns. */
export async function classifiedPieces(
  indexer: client.IndexerClient,
  rpc: RpcClient,
  tick: string,
  address: string,
  covid: string,
): Promise<{ legacy: Kcc20Piece[]; standard: Kcc20StandardPiece[] }> {
  const walletSpk = payToAddressScript(address).script;
  // A standard owner is an x-only key or its hash: only a Schnorr P2PK wallet has one.
  const walletPubkey = /^20([0-9a-f]{64})ac$/.exec(walletSpk)?.[1];
  const claimed = new Map<
    string,
    {
      outpoint: { transactionId: string; index: number };
      state: kcc20.Kcc20State;
      redeem: Uint8Array;
      p2sh: string;
    }
  >();
  const standardClaimed = new Map<
    string,
    {
      outpoint: { transactionId: string; index: number };
      state: KCC20State;
      redeem: Uint8Array;
      p2sh: string;
    }
  >();
  for (const utxo of (await indexer.tokenUtxos(tick, address)) ?? []) {
    try {
      const redeem = hexToBytes(`0x${utxo.redeemScriptHex}`);
      const classified = classifyRedeem(redeem);
      if (classified.family === "unknown") continue;
      const owned =
        classified.family === "kron-legacy"
          ? isOwnedBy(classified.state, walletSpk)
          : !!walletPubkey &&
            isStandardOwnedBy(
              classified.state,
              hexToBytes(`0x${walletPubkey}`),
            );
      if (!owned) continue;
      const p2sh = addressFromScriptPublicKey(
        payToScriptHashScript(redeem),
        "mainnet",
      )?.toString();
      if (!p2sh) continue;
      const { transactionId, index } = utxo.outpoint;
      const key = `${transactionId}:${index}`;
      const outpoint = { transactionId, index };
      // A standard piece never joins `claimed`: the legacy counter and selectPieces never see it.
      if (classified.family === "kcc20-standard") {
        standardClaimed.set(key, {
          outpoint,
          state: classified.state,
          redeem,
          p2sh,
        });
        continue;
      }
      claimed.set(key, { outpoint, state: classified.state, redeem, p2sh });
    } catch {
      // Not a kcc20 redeem script: nothing to count.
    }
  }
  if (claimed.size === 0 && standardClaimed.size === 0)
    return { legacy: [], standard: [] };

  const live = await liveEntries(rpc, [
    ...new Set(
      [...claimed.values(), ...standardClaimed.values()].map((c) => c.p2sh),
    ),
  ]);
  const nodeValue = <
    T extends { outpoint: Kcc20Piece["outpoint"]; p2sh: string },
  >(
    c: T,
  ) => {
    const hit = covenantSelect.selectCovenantTokenOutpoint(
      live,
      c.outpoint,
      covid,
    );
    return hit?.address === c.p2sh ? hit.amount : undefined;
  };

  const pieces: Kcc20Piece[] = [];
  for (const c of claimed.values()) {
    const value = nodeValue(c);
    if (value !== undefined) {
      pieces.push({
        outpoint: c.outpoint,
        state: c.state,
        redeem: c.redeem,
        value,
      });
    }
  }
  const standard: Kcc20StandardPiece[] = [];
  for (const c of standardClaimed.values()) {
    const value = nodeValue(c);
    if (value !== undefined) {
      standard.push({
        outpoint: c.outpoint,
        state: c.state,
        redeem: c.redeem,
        value,
      });
    }
  }
  return { legacy: pieces, standard };
}

async function verifiedBalance(
  indexer: client.IndexerClient,
  rpc: RpcClient,
  tick: string,
  address: string,
  covid: string,
) {
  const { legacy, standard } = await classifiedPieces(
    indexer,
    rpc,
    tick,
    address,
    covid,
  );
  // A minter piece's amount is mint authority, not a balance.
  const pieces = legacy.filter((p) => !p.state.isMinter);
  const sum = (ps: Kcc20Piece[]) => ps.reduce((s, p) => s + p.state.amount, 0n);
  // Standard pieces add nothing to either balance; they only mark the row.
  const family: Kcc20Family =
    legacy.length === 0 && standard.length > 0
      ? "kcc20-standard"
      : "kron-legacy";
  return {
    family,
    amount: sum(pieces),
    spendable: sum(
      pieces.filter((p) => p.state.identifierType === kcc20.IDENTIFIER.ADDRESS),
    ),
  };
}

export async function verifiedMeta(
  entry: TokenListEntry | undefined,
  restApi: string,
): Promise<Kcc20Token["meta"]> {
  if (
    !entry ||
    !Number.isInteger(entry.decimals) ||
    entry.decimals < 0 ||
    entry.decimals > 18
  ) {
    return undefined;
  }
  // A throw drops this token only; rejecting would empty the whole list.
  let ok = false;
  try {
    ({ ok } = await verify.verifyTokenListEntry(
      entry,
      verify.kaspaRestFetchTx(restApi),
    ));
  } catch {
    // unverifiable, same as !ok
  }
  if (!ok) return undefined;
  const { symbol, name, decimals, logoURI } = entry;
  return { symbol, name, decimals, logoURI };
}

/** The clients fetchKcc20Tokens reads through; each defaults to the live mainnet one. */
export type Kcc20TokenDeps = {
  indexer?: client.IndexerClient;
  registry?: client.RegistryClient;
  fetchKascov?: KascovFetchers;
};

type KascovFetchers = {
  holdings: typeof fetchStandardHoldings;
  ownerCells: typeof fetchOwnerCells;
};

const LIVE_KASCOV: KascovFetchers = {
  holdings: fetchStandardHoldings,
  ownerCells: fetchOwnerCells,
};

/**
 * The wallet's KCC-20 holdings on mainnet: legacy rows (one per covenant id,
 * verified balance and metadata only), then, with `standard`, the KCC-20
 * standard rows (node-verified balance, claimed metadata).
 */
export async function fetchKcc20Tokens(
  address: string,
  rpc: RpcClient,
  restApi: string,
  { standard = false, ...deps }: { standard?: boolean } & Kcc20TokenDeps = {},
): Promise<Kcc20Token[]> {
  const [legacy, standardRows] = await Promise.all([
    fetchLegacyTokens(address, rpc, restApi, deps),
    standard ? fetchStandardTokens(address, rpc, deps.fetchKascov) : [],
  ]);
  return [...legacy, ...standardRows];
}

// kascov is asked only which ids exist; past STANDARD_TOKEN_CAP ids are ignored.
const STANDARD_TOKEN_CAP = 20;
const STANDARD_CONCURRENCY = 3;

/** `fn` over `items`, at most `limit` in flight; results in input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** Claimed metadata, marked unverified; undefined without a ticker and sane decimals. */
function claimedMeta(holding: KascovHolding): Kcc20Token["meta"] {
  const { claimedTicker, claimedName, displayDecimals } = holding;
  if (!claimedTicker || displayDecimals === undefined) return undefined;
  // claimed_image is left out: an airdropped token's creator would see every
  // holder's IP fetch it.
  return {
    symbol: claimedTicker,
    name: claimedName || claimedTicker,
    decimals: displayDecimals,
    unverified: true,
  };
}

/** One token id's rows, one per extension commitment; a group whose pieces disagree with their cells is dropped. */
async function standardRowsFor(
  holding: KascovHolding,
  rpc: RpcClient,
  walletPubkey32: Uint8Array,
  kascov: KascovFetchers,
): Promise<Kcc20Token[]> {
  const pk = bytesToHex(walletPubkey32).slice(2);
  const tuples = [`00${pk}`, `01${bytesToHex(hash(walletPubkey32)).slice(2)}`];
  const cells = new Map(
    (
      await Promise.all(
        tuples.map((t) => kascov.ownerCells(holding.tokenId, t)),
      )
    )
      .flat()
      .map((c) => [`${c.outpoint.transactionId}:${c.outpoint.index}`, c]),
  );
  const pieces = await verifyStandardCells({
    cells: [...cells.values()],
    covenantId: holding.tokenId,
    rpc,
    walletPubkey32,
  });

  const groups = new Map<string, StandardPiece[]>();
  const disagreeing = new Set<string>();
  for (const p of pieces) {
    const ext = cells.get(
      `${p.outpoint.transactionId}:${p.outpoint.index}`,
    )!.extensionCommitment;
    if (bytesToHex(p.state.extensionCommitment).slice(2) !== ext)
      disagreeing.add(ext);
    groups.set(ext, [...(groups.get(ext) ?? []), p]);
  }
  const meta = claimedMeta(holding);
  return [...groups]
    .filter(([ext]) => !disagreeing.has(ext))
    .map(([ext, group]) => ({
      covenantId: pieces[0].tokenId,
      family: "kcc20-standard" as const,
      tick: holding.claimedTicker ?? "",
      amount: group.reduce((s, p) => s + p.state.amount, 0n),
      // Display-only: a standard transfer needs a signature inside the
      // witness argument, which the signer cannot express.
      spendable: 0n,
      meta,
      extensionCommitment: ext,
    }))
    .filter((t) => t.amount > 0n);
}

/** The wallet's KCC-20 standard rows. Never throws: any failure yields fewer rows. */
async function fetchStandardTokens(
  address: string,
  rpc: RpcClient,
  kascov: KascovFetchers = LIVE_KASCOV,
): Promise<Kcc20Token[]> {
  try {
    // A standard owner is an x-only key or its hash: only a Schnorr P2PK wallet has one.
    const pk = /^20([0-9a-f]{64})ac$/.exec(
      payToAddressScript(address).script,
    )?.[1];
    if (!pk) return [];
    const walletPubkey32 = hexToBytes(`0x${pk}`);
    const holdings = [
      ...new Map(
        (await kascov.holdings(address)).map((h) => [h.tokenId, h]),
      ).values(),
    ].slice(0, STANDARD_TOKEN_CAP);
    const rows = await mapLimit(holdings, STANDARD_CONCURRENCY, (h) =>
      standardRowsFor(h, rpc, walletPubkey32, kascov).catch(() => []),
    );
    return rows.flat();
  } catch {
    return [];
  }
}

async function fetchLegacyTokens(
  address: string,
  rpc: RpcClient,
  restApi: string,
  {
    indexer = new client.IndexerClient(KRON_INDEXER_URL),
    registry: registryClient = new client.RegistryClient(KRON_REGISTRY_URL),
  }: Kcc20TokenDeps = {},
): Promise<Kcc20Token[]> {
  const [rows, registry] = await Promise.all([
    indexer.tokenlist(address),
    // Registry down: nothing verifies, so no token shows.
    registryClient.tokenlist().catch(() => undefined),
  ]);

  // The covenant id is the token's identity (fungibility); the tick is only
  // the indexer's route to its UTXOs. The legacy family has no extension
  // commitment, so for it the covenant id alone is the grouping key; a
  // standard family groups by covenant id and extension commitment. Only
  // legacy rows carry a balance, so grouping by covenant id is enough here.
  const tickByCovid = new Map<string, string>();
  for (const row of (rows ?? []) as { tick: string; covenantId?: string }[]) {
    const covid = covenantSelect.normalizedCovenantId(row.covenantId);
    if (covid && !tickByCovid.has(covid)) tickByCovid.set(covid, row.tick);
  }

  const tokens: (Kcc20Token | undefined)[] = await Promise.all(
    [...tickByCovid].map(async ([covid, tick]) => {
      try {
        const { family, amount, spendable } = await verifiedBalance(
          indexer,
          rpc,
          tick,
          address,
          covid,
        );
        // Skips the genesis-tx fetch; shouldIncludeToken is still the gate.
        if (amount === 0n) return undefined;
        const entry = registry?.tokens.find(
          (t) =>
            t.network === "mainnet" &&
            covenantSelect.normalizedCovenantId(t.covenantId) === covid,
        );
        return {
          covenantId: covid,
          family,
          tick,
          amount,
          spendable,
          meta: await verifiedMeta(entry, restApi),
        };
      } catch {
        // One token's lookup failing drops that row; it must not blank the rest.
        return undefined;
      }
    }),
  );
  return tokens.filter(
    (t): t is Kcc20Token =>
      t !== undefined && shouldIncludeToken(t.meta, t.amount),
  );
}

/** An error for an amount with more fractional digits than the token has: parseUnits would silently round it. */
export function decimalsError(input: string, decimals: number, symbol: string) {
  if ((input.trim().split(".")[1]?.length ?? 0) <= decimals) return undefined;
  return decimals === 0
    ? `${symbol} has no decimal places`
    : `${symbol} has at most ${decimals} decimal places`;
}
