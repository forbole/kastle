import { client, covenantSelect } from "@kronsdk/kron-sdk";
import { bytesToHex, hexToBytes } from "viem";
import { payToAddressScript, RpcClient } from "@/wasm/core/kaspa";
import {
  classifiedPieces,
  claimedMeta,
  KascovFetchers,
  KRON_HOSTS,
  KronNetwork,
  mapLimit,
  ownedStandardCells,
} from "./index";
import { fetchOwnerCells, fetchStandardHoldings } from "./providers/kascov";
import type { WalletKcc20Piece } from "./dapp-request";

// A sign guard, not a display list: past this many tokens the scan is refused, never cut.
const PIECES_TOKEN_CAP = 50;
const KASCOV_CONCURRENCY = 3;

const outpointKey = (p: WalletKcc20Piece) =>
  `${p.outpoint.transactionId}:${p.outpoint.index}`;

const displayDecimals = (d: unknown) =>
  Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 18
    ? (d as number)
    : undefined;

/**
 * Every node-verified KCC-20 piece `address` holds, for the dApp sign guard.
 * Throws on any failure or incomplete scan (indexer, registry list cap, RPC,
 * kascov, truncated cells): the caller refuses to sign rather than show "nothing".
 * Metadata is display-only (indexer row, then registry entry, or kascov claims),
 * never verified here.
 * Standard pieces via kascov need mainnet and `standard`; elsewhere only what the
 * KRON indexer reports (legacy, plus any standard piece it classifies).
 */
export async function walletKcc20Pieces(
  address: string,
  rpc: RpcClient,
  {
    network,
    standard,
    indexer,
    registry: registryClient,
    kascov = { holdings: fetchStandardHoldings, ownerCells: fetchOwnerCells },
  }: {
    network: string;
    standard: boolean;
    indexer?: client.IndexerClient;
    registry?: client.RegistryClient;
    kascov?: KascovFetchers;
  },
): Promise<WalletKcc20Piece[]> {
  if (!(network in KRON_HOSTS))
    throw new Error(`KCC-20 is not indexed on ${network}`);
  const net = network as KronNetwork;
  const hosts = KRON_HOSTS[net];
  indexer ??= new client.IndexerClient(hosts.indexer);
  registryClient ??= new client.RegistryClient(hosts.registry);

  const [rows, registry] = await Promise.all([
    indexer.tokenlist(address),
    // Metadata only: without the list every symbol falls back to the short id.
    registryClient.tokenlist().catch(() => undefined),
  ]);
  // A missing list or an unidentifiable row is an incomplete scan, never "no tokens".
  if (!Array.isArray(rows))
    throw new Error("KRON indexer returned no token list");
  type Row = {
    tick: string;
    covenantId?: string;
    symbol?: unknown;
    dec?: unknown;
  };
  const rowByCovid = new Map<string, Row>();
  for (const row of rows as Row[]) {
    const covid = covenantSelect.normalizedCovenantId(row?.covenantId);
    if (!covid)
      throw new Error(`KRON indexer row without a covenant id (${row?.tick})`);
    if (!rowByCovid.has(covid)) rowByCovid.set(covid, row);
  }
  if (rowByCovid.size > PIECES_TOKEN_CAP)
    throw new Error(`more than ${PIECES_TOKEN_CAP} KCC-20 tokens`);

  const pieces = new Map<string, WalletKcc20Piece>();
  const add = (p: WalletKcc20Piece) => pieces.set(outpointKey(p), p);

  // No per-token catch: one token failing to load fails the whole scan.
  const legacyScans = await Promise.all(
    [...rowByCovid].map(async ([covid, row]) => ({
      covid,
      row,
      entry: registry?.tokens.find(
        (t) =>
          t.network === hosts.registryNetwork &&
          covenantSelect.normalizedCovenantId(t.covenantId) === covid,
      ),
      ...(await classifiedPieces(indexer, rpc, row.tick, address, covid, net)),
    })),
  );
  for (const { covid, row, entry, legacy, standard: std } of legacyScans) {
    // The indexer row first, the registry entry as fallback.
    const meta = {
      symbol:
        typeof row.symbol === "string" && row.symbol
          ? row.symbol
          : (entry?.symbol ?? ""),
      decimals: displayDecimals(row.dec) ?? displayDecimals(entry?.decimals),
    };
    for (const p of legacy)
      add({
        outpoint: p.outpoint,
        covenantId: covid,
        family: "kron-legacy",
        amount: p.state.amount,
        ...meta,
      });
    for (const p of std)
      add({
        outpoint: p.outpoint,
        covenantId: covid,
        family: "kcc20-standard",
        extensionCommitment: bytesToHex(p.state.extensionCommitment).slice(2),
        amount: p.state.amount,
        ...meta,
      });
  }

  // kascov serves mainnet only; a standard owner is a Schnorr P2PK key.
  const pk = /^20([0-9a-f]{64})ac$/.exec(
    payToAddressScript(address).script,
  )?.[1];
  if (standard && net === "mainnet") {
    if (!pk)
      throw new Error(
        "standard KCC-20 pieces can only be scanned for a Schnorr P2PK address",
      );
    const holdings = [
      ...new Map(
        (await kascov.holdings(address)).map((h) => [h.tokenId, h]),
      ).values(),
    ];
    if (holdings.length > PIECES_TOKEN_CAP)
      throw new Error(`more than ${PIECES_TOKEN_CAP} KCC-20 standard tokens`);
    const walletPubkey32 = hexToBytes(`0x${pk}`);
    const scans = await mapLimit(holdings, KASCOV_CONCURRENCY, async (h) => ({
      h,
      ...(await ownedStandardCells(h.tokenId, rpc, walletPubkey32, kascov)),
    }));
    for (const { h, owned, truncated } of scans) {
      if (truncated) throw new Error(`kascov truncated ${h.tokenId}`);
      const meta = claimedMeta(h);
      for (const { piece } of owned)
        add({
          outpoint: piece.outpoint,
          covenantId: piece.tokenId,
          family: "kcc20-standard",
          extensionCommitment: bytesToHex(
            piece.state.extensionCommitment,
          ).slice(2),
          amount: piece.state.amount,
          symbol: meta?.symbol ?? "",
          decimals: displayDecimals(meta?.decimals),
        });
    }
  }
  return [...pieces.values()];
}
