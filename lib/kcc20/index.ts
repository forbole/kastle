import { client, covenantSelect, kcc20, verify } from "@kronsdk/kron-sdk";
import { bytesToHex, hexToBytes } from "viem";
import {
  addressFromScriptPublicKey,
  payToAddressScript,
  payToScriptHashScript,
  RpcClient,
} from "@/wasm/core/kaspa";

// ponytail: mainnet only, KRON publishes no testnet indexer or registry yet.
export const KRON_INDEXER_URL = "https://idx.kron.technology/v1/kcc20";
export const KRON_REGISTRY_URL = "https://api.kron.technology";

type TokenListEntry = verify.SignedTokenList["tokens"][number];

export type Kcc20Token = {
  covenantId: string;
  // Base units, summed from UTXOs the node confirmed; never the indexer's figure.
  amount: bigint;
  // Set only when the registry entry for this covenant id verified against its genesis tx.
  meta?: { symbol: string; name: string; decimals: number; logoURI?: string };
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
async function verifiedBalance(
  indexer: client.IndexerClient,
  rpc: RpcClient,
  tick: string,
  address: string,
  covid: string,
) {
  const walletSpk = payToAddressScript(address).script;
  const claimed = new Map<
    string,
    {
      outpoint: { transactionId: string; index: number };
      amount: bigint;
      p2sh: string;
    }
  >();
  for (const utxo of (await indexer.tokenUtxos(tick, address)) ?? []) {
    try {
      const redeem = hexToBytes(`0x${utxo.redeemScriptHex}`);
      const { state } = kcc20.decodeKcc20Redeem(redeem);
      if (!isOwnedBy(state, walletSpk)) continue;
      const p2sh = addressFromScriptPublicKey(
        payToScriptHashScript(redeem),
        "mainnet",
      )?.toString();
      if (!p2sh) continue;
      const { transactionId, index } = utxo.outpoint;
      claimed.set(`${transactionId}:${index}`, {
        outpoint: { transactionId, index },
        amount: state.amount,
        p2sh,
      });
    } catch {
      // Not a kcc20 redeem script: nothing to count.
    }
  }
  if (claimed.size === 0) return 0n;

  const { entries } = await rpc.getUtxosByAddresses([
    ...new Set([...claimed.values()].map((c) => c.p2sh)),
  ]);
  const live = entries.map((e) => ({
    outpoint: {
      transactionId: e.outpoint.transactionId,
      index: e.outpoint.index,
    },
    covenantId: covenantSelect.normalizedCovenantId(e.entry.covenantId),
    address: e.address?.toString(),
  }));

  let total = 0n;
  for (const c of claimed.values()) {
    const hit = covenantSelect.selectCovenantTokenOutpoint(
      live,
      c.outpoint,
      covid,
    );
    if (hit?.address === c.p2sh) total += c.amount;
  }
  return total;
}

async function verifiedMeta(
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
  const { ok } = await verify.verifyTokenListEntry(
    entry,
    verify.kaspaRestFetchTx(restApi),
  );
  if (!ok) return undefined;
  const { symbol, name, decimals, logoURI } = entry;
  return { symbol, name, decimals, logoURI };
}

/** The wallet's KCC-20 holdings on mainnet, one row per covenant id, verified balance and metadata only. */
export async function fetchKcc20Tokens(
  address: string,
  rpc: RpcClient,
  restApi: string,
): Promise<Kcc20Token[]> {
  const indexer = new client.IndexerClient(KRON_INDEXER_URL);
  const [rows, registry] = await Promise.all([
    indexer.tokenlist(address),
    // Registry down: nothing verifies, so no token shows.
    new client.RegistryClient(KRON_REGISTRY_URL)
      .tokenlist()
      .catch(() => undefined),
  ]);

  // The covenant id is the token's identity (fungibility); the tick is only
  // the indexer's route to its UTXOs. KRON's on-chain state carries no
  // extension commitment, so the covenant id alone is the grouping key.
  const tickByCovid = new Map<string, string>();
  for (const row of (rows ?? []) as { tick: string; covenantId?: string }[]) {
    const covid = covenantSelect.normalizedCovenantId(row.covenantId);
    if (covid && !tickByCovid.has(covid)) tickByCovid.set(covid, row.tick);
  }

  const tokens: (Kcc20Token | undefined)[] = await Promise.all(
    [...tickByCovid].map(async ([covid, tick]) => {
      const amount = await verifiedBalance(indexer, rpc, tick, address, covid);
      // Skips the genesis-tx fetch; shouldIncludeToken is still the gate.
      if (amount === 0n) return undefined;
      const entry = registry?.tokens.find(
        (t) =>
          t.network === "mainnet" &&
          covenantSelect.normalizedCovenantId(t.covenantId) === covid,
      );
      return {
        covenantId: covid,
        amount,
        meta: await verifiedMeta(entry, restApi),
      };
    }),
  );
  return tokens.filter(
    (t): t is Kcc20Token =>
      t !== undefined && shouldIncludeToken(t.meta, t.amount),
  );
}
