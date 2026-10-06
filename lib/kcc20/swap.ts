// KRON curve swaps: KAS -> KCC-20 (buy) and KCC-20 -> KAS (sell) against a
// token's pre-graduation bonding curve. Pool (post-graduation) trades and
// liquidity are not supported.
import {
  client,
  covenantSelect,
  curve,
  curveCp,
  kcc20,
  spend,
} from "@kronsdk/kron-sdk";
import { hexToBytes } from "viem";
import * as kaspa from "@/wasm/core/kaspa";
import { RpcClient } from "@/wasm/core/kaspa";
import { KASTLE_SWAP_FEE_BPS } from "@/lib/swap-bridge-quote";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import {
  KRON_INDEXER_URL,
  KRON_REGISTRY_URL,
  TokenListEntry,
  liveEntries,
  verifiedMeta,
  verifiedPieces,
} from "@/lib/kcc20";
import {
  BuiltKcc20Transfer,
  Kcc20TransferError,
  fundCovenantSpend,
  recipientPubkey,
  selectPieces,
  sendKcc20Transfer,
  signKcc20Transfer,
} from "@/lib/kcc20/transfer";

export const KRON_SEQUENCER_URL = "https://seq.kron.technology";

export type KronSide = "buy" | "sell";

export class KronSwapError extends Error {
  constructor(
    readonly code:
      | "unverified"
      | "graduated"
      | "curve-busy"
      | "too-small"
      | "price-moved",
    message: string,
  ) {
    super(message);
  }
}

/** A token tradable on its curve. Display fields are the registry's until `verifiedMeta` passes at quote time. */
export type KronMarket = {
  covenantId: string;
  curveCovenantId: string;
  // The indexer's route to the token's UTXOs and curve state.
  tick: string;
  entry: TokenListEntry;
};

export async function fetchKronMarkets(): Promise<KronMarket[]> {
  const [markets, list] = await Promise.all([
    new client.IndexerClient(KRON_INDEXER_URL).markets({ kind: "curve" }),
    new client.RegistryClient(KRON_REGISTRY_URL).tokenlist(),
  ]);
  const tickByCovid = new Map(
    markets
      .filter((m) => !m.graduated)
      .map((m) => [covenantSelect.normalizedCovenantId(m.covenantId), m.tick]),
  );
  return list.tokens.flatMap((entry) => {
    const covenantId = covenantSelect.normalizedCovenantId(entry.covenantId);
    const curveCovenantId = covenantSelect.normalizedCovenantId(
      entry.extensions.curveCovenantId,
    );
    const tick = covenantId && tickByCovid.get(covenantId);
    if (
      entry.network !== "mainnet" ||
      entry.extensions.graduated ||
      !entry.extensions.curveParams ||
      !curveCovenantId ||
      !tick
    )
      return [];
    return [{ covenantId: covenantId!, curveCovenantId, tick, entry }];
  });
}

/**
 * The Kastle fee on the KAS leg. Floored at the SDK's 0.2 KAS fee-output
 * minimum: a smaller output's storage mass alone exceeds the standard limit.
 */
export const kronKastleFee = (kas: bigint) => {
  const fee = (kas * KASTLE_SWAP_FEE_BPS) / 10_000n;
  return fee > curve.FEE_OUT_MIN ? fee : curve.FEE_OUT_MIN;
};

export type KronQuote = {
  side: KronSide;
  // Buy: KAS sompi incl. the Kastle fee. Sell: token base units.
  amountIn: bigint;
  // What the user receives. Buy: token base units. Sell: KAS sompi net of all fees but the network fee.
  amountOut: bigint;
  kastleFee: bigint;
  // Creator + platform + dev-fund legs, sompi; paid on top of a buy, out of a sell.
  curveFee: bigint;
  // The curve leg the builder signs: kasIn (buy) or kasOut (sell).
  curveKas: bigint;
  // The curve's reserves after this trade, declared to the sequencer.
  newRealKas: bigint;
  newTokenReserve: bigint;
};

/**
 * Buy: the Kastle fee comes off the KAS in, the rest goes to the curve.
 * Sell: the Kastle fee comes off the curve's net KAS out.
 * undefined: too small to trade once the fixed fee outputs are paid.
 */
export function quoteKron(
  state: curve.CpState,
  side: KronSide,
  amountIn: bigint,
): KronQuote | undefined {
  if (side === "buy") {
    const kastleFee = kronKastleFee(amountIn);
    if (amountIn <= kastleFee) return undefined;
    const q = curve.quoteCpBuy(state, amountIn - kastleFee);
    // Fees above the curve leg itself: a dust buy paying many times its worth.
    if (!q || kastleFee + q.fee > q.kasIn) return undefined;
    return {
      side,
      amountIn,
      amountOut: q.tokenOut,
      kastleFee,
      curveFee: q.fee,
      curveKas: q.kasIn,
      newRealKas: q.newRealKas,
      newTokenReserve: q.newTokenReserve,
    };
  }
  const q = curve.quoteCpSell(state, amountIn);
  if (!q) return undefined;
  const kastleFee = kronKastleFee(q.net);
  if (q.net <= kastleFee) return undefined;
  return {
    side,
    amountIn,
    amountOut: q.net - kastleFee,
    kastleFee,
    curveFee: q.fee,
    curveKas: q.kasOut,
    newRealKas: q.newRealKas,
    newTokenReserve: q.newTokenReserve,
  };
}

type K = Parameters<typeof curveCp.buildCpBuy>[0];

// Templates are static per token and the endpoint is compile-rate-limited.
const templates = new Map<string, Promise<client.CpTemplates>>();
function cpTemplates(market: KronMarket) {
  let tpls = templates.get(market.covenantId);
  if (!tpls) {
    const { curveParams, templateVersion } = market.entry.extensions;
    tpls = client.fetchCpTemplates({
      baseUrl: KRON_REGISTRY_URL,
      tokenCovid: market.covenantId,
      curveParams: curveParams as unknown as Record<string, unknown>,
      templateVersion: templateVersion ?? null,
    });
    tpls.catch(() => templates.delete(market.covenantId));
    templates.set(market.covenantId, tpls);
  }
  return tpls;
}

const metas = new Map<string, ReturnType<typeof verifiedMeta>>();
/** Registry metadata, only once it verified against the token's genesis tx. */
export function kronMeta(market: KronMarket, restApi: string) {
  let meta = metas.get(market.covenantId);
  if (!meta) {
    meta = verifiedMeta(market.entry, restApi);
    metas.set(market.covenantId, meta);
    // An unverified result may be a transient REST failure: retry next time.
    meta.then(
      (m) => {
        if (!m) metas.delete(market.covenantId);
      },
      () => metas.delete(market.covenantId),
    );
  }
  return meta;
}

/** Native KAS on a token outpoint: the UTXO index, or the mempool for one the sequencer chained but not yet confirmed. */
async function outputValue(
  rpc: RpcClient,
  outpoint: { transactionId: string; index: number },
  address: string,
  covid: string,
) {
  const hit = covenantSelect.selectCovenantTokenOutpoint(
    await liveEntries(rpc, [address]),
    outpoint,
    covid,
  );
  if (hit) return hit.amount as bigint;
  const { mempoolEntry } = await rpc
    .getMempoolEntry({
      transactionId: outpoint.transactionId,
      includeOrphanPool: false,
      filterTransactionPool: false,
    })
    .catch(() => ({ mempoolEntry: undefined }));
  const out = mempoolEntry?.transaction.outputs[outpoint.index];
  if (!out) {
    throw new KronSwapError("curve-busy", "The curve just traded; try again");
  }
  return BigInt(out.value);
}

/**
 * The live curve and inventory UTXOs. The sequencer's head includes trades
 * still in the mempool (the curve's address changes on every trade); with
 * none in flight it is null and the confirmed state is read off the node.
 * A failed lookup fails closed: submitting direct would race queued trades.
 * A wrong head only gets the trade rejected: the P2SH binds every value.
 */
async function liveCurve(
  rpc: RpcClient,
  k: K,
  tpls: client.CpTemplates,
  market: KronMarket,
) {
  const tokenCovid = hexToBytes(`0x${market.covenantId}`);
  const curveCovid = hexToBytes(`0x${market.curveCovenantId}`);
  const inventoryAddress = (tokenReserve: bigint) =>
    kcc20.kcc20Address(
      k,
      tpls.token,
      kcc20.covenantIdOwned(curveCovid, tokenReserve, false),
      "mainnet",
    );

  const seq = await new client.SequencerClient(KRON_SEQUENCER_URL)
    .curveHead(market.curveCovenantId)
    .catch(() => undefined);
  if (!seq?.ok) {
    throw new KronSwapError("curve-busy", "The curve sequencer is unavailable");
  }
  if (seq.head) {
    const { poolOutpoint, poolTokenOutpoint, reserves } = seq.head;
    const tokenReserve = BigInt(reserves.tokenReserve);
    return {
      // Built on an in-flight chain: must queue behind it via the sequencer.
      head: seq.head,
      curve: {
        ...poolOutpoint,
        realKas: BigInt(reserves.realKas),
        state: { graduated: false, tokenCovid, tokenReserve },
      },
      inventory: {
        ...poolTokenOutpoint,
        amount: tokenReserve,
        value: await outputValue(
          rpc,
          poolTokenOutpoint,
          inventoryAddress(tokenReserve),
          market.covenantId,
        ),
      },
    };
  }

  const info = await new client.IndexerClient(KRON_INDEXER_URL).token(
    market.tick,
  );
  if (info.graduated) {
    throw new KronSwapError(
      "graduated",
      "This token has graduated from its curve",
    );
  }
  // The decimal string: cpState's number loses precision past 2^53.
  const tokenReserve = BigInt(info.tokenReserve);
  const state = { graduated: false, tokenCovid, tokenReserve };
  const entries = await liveEntries(rpc, [
    curveCp.cpAddress(k, tpls.curve, state, "mainnet"),
    inventoryAddress(tokenReserve),
  ]);
  // Lineage only: the curve's value is its realKas, read off the entry.
  const c = covenantSelect.selectCovenantUtxo(
    entries,
    market.curveCovenantId,
    null,
  );
  const inv = covenantSelect.selectCovenantTokenUtxo(
    entries,
    market.covenantId,
  );
  if (!c || !inv) {
    throw new KronSwapError("curve-busy", "The curve just traded; try again");
  }
  return {
    head: undefined,
    curve: { ...c.outpoint, realKas: c.amount as bigint, state },
    inventory: {
      ...inv.outpoint,
      value: inv.amount as bigint,
      amount: tokenReserve,
    },
  };
}

async function loadCurve(rpc: RpcClient, market: KronMarket) {
  const k = kaspa as unknown as K;
  const tpls = await cpTemplates(market);
  const live = await liveCurve(rpc, k, tpls, market);
  const p = tpls.curve.params;
  const state: curve.CpState = {
    realKas: live.curve.realKas,
    tokenReserve: live.curve.state.tokenReserve,
    vKas: p.vKas,
    graduationKas: p.graduationKas,
    creatorFeeBps: p.creatorFeeBps,
    platformFeeBps: p.platformFeeBps,
    devFundBps: p.devFundBps ?? 0n,
  };
  return { k, tpls, ...live, state };
}

export async function quoteKronSwap(
  rpc: RpcClient,
  market: KronMarket,
  side: KronSide,
  amountIn: bigint,
) {
  const { state } = await loadCurve(rpc, market);
  return quoteKron(state, side, amountIn);
}

export type BuiltKronSwap = Omit<BuiltKcc20Transfer, "amount" | "kasDebit"> & {
  quote: KronQuote;
  // The sequencer head the trade was built on; undefined: confirmed state.
  head?: NonNullable<
    Extract<
      Awaited<ReturnType<client.SequencerClient["curveHead"]>>,
      { ok: true }
    >["head"]
  >;
};

/** Re-quotes against the live curve, refuses below `minOut`, and builds the unsigned trade. */
export async function buildKronSwap({
  rpc,
  market,
  side,
  amountIn,
  minOut,
  address,
  feeRate,
}: {
  rpc: RpcClient;
  market: KronMarket;
  side: KronSide;
  amountIn: bigint;
  minOut: bigint;
  address: string;
  feeRate?: number;
}): Promise<BuiltKronSwap> {
  const {
    k,
    tpls,
    head,
    curve: c,
    inventory,
    state,
  } = await loadCurve(rpc, market);
  const quote = quoteKron(state, side, amountIn);
  if (!quote) {
    throw new KronSwapError("too-small", `Amount too small to ${side}`);
  }
  if (quote.amountOut < minOut) {
    throw new KronSwapError(
      "price-moved",
      "The price moved past your slippage; review the new quote",
    );
  }
  const me = recipientPubkey(address);
  const curveCovid = hexToBytes(`0x${market.curveCovenantId}`);

  // Inputs are curve, inventory, [seller pieces], then funding. The first
  // funding input is the wallet's own P2PK input that recipient-bound
  // schemas bind the trade to; legacy schemas ignore the index.
  let covenantSpend: spend.CovenantSpend;
  if (side === "buy") {
    covenantSpend = curveCp.buildCpBuy(
      k,
      tpls.curve,
      tpls.token,
      c,
      inventory,
      curveCovid,
      me,
      quote.curveKas,
      quote.amountOut,
      [],
      2,
    );
  } else {
    const pieces = selectPieces(
      await verifiedPieces(
        new client.IndexerClient(KRON_INDEXER_URL),
        rpc,
        market.tick,
        address,
        market.covenantId,
      ),
      amountIn,
      market.entry.decimals,
      "sell",
    );
    covenantSpend = curveCp.buildCpSell(
      k,
      tpls.curve,
      tpls.token,
      c,
      pieces.map((p) => ({ ...p.outpoint, value: p.value, state: p.state })),
      inventory,
      curveCovid,
      me,
      amountIn,
      quote.curveKas,
      2 + pieces.length,
    );
  }

  const { entries } = await rpc.getUtxosByAddresses([address]);
  const funded = fundCovenantSpend({
    spend: covenantSpend,
    funding: entries,
    address,
    feeRate,
    kastleFee: quote.kastleFee,
  });
  // A sell whose network fee eats the KAS out nets the user nothing or less.
  if (side === "sell" && quote.amountOut <= funded.fee) {
    throw new KronSwapError("too-small", "Amount too small to sell");
  }
  return { ...funded, quote, head };
}

/**
 * Signs and submits the trade. One built on an in-flight sequencer head is
 * queued behind it; straight to the node it would race the queued trades.
 */
export async function submitKronSwap(
  wallet: IWallet,
  built: BuiltKronSwap,
  rpc: RpcClient,
  market: KronMarket,
) {
  if (!built.head) return sendKcc20Transfer(wallet, built, rpc);
  const signed = await signKcc20Transfer(wallet, built);
  const res = await new client.SequencerClient(KRON_SEQUENCER_URL).curveSubmit({
    covid: market.curveCovenantId,
    signedTx: signed.serializeToSafeJSON(),
    prevHead: built.head,
    declaredReserves: {
      realKas: built.quote.newRealKas.toString(),
      tokenReserve: built.quote.newTokenReserve.toString(),
      vKas: built.head.reserves.vKas,
    },
  });
  if (!res.ok) throw new KronSwapError("curve-busy", res.reason);
  return res.txid;
}

/** Refuses a market whose registry entry did not verify against its genesis tx, or whose verified decimals differ from the ones amounts were parsed with. */
export async function assertKronVerified(market: KronMarket, restApi: string) {
  const meta = await kronMeta(market, restApi);
  if (!meta || meta.decimals !== market.entry.decimals) {
    throw new KronSwapError(
      "unverified",
      "This token's details could not be verified",
    );
  }
  return meta;
}

/** The Kastle fee as bps of the KAS leg it came off; above 75 only when the 0.2 KAS floor applied. */
export function kronKastleFeeBps(q: KronQuote) {
  const kas = q.side === "buy" ? q.amountIn : q.amountOut + q.kastleFee;
  const bps = Number((q.kastleFee * 10_000n + kas - 1n) / kas);
  return Math.max(bps, Number(KASTLE_SWAP_FEE_BPS));
}

const KRON_ERROR_COPY: Record<KronSwapError["code"], string> = {
  unverified: "This token's details could not be verified",
  graduated: "This token has graduated and can no longer be swapped here",
  "curve-busy": "The curve is busy right now. Please try again.",
  "too-small": "Amount is too small to swap",
  "price-moved":
    "The price moved beyond your slippage. Review the new quote and try again.",
};

/** User-facing copy for a failed KRON quote or swap. */
export function kronErrorCopy(e: unknown, fallback: string) {
  if (e instanceof KronSwapError) return KRON_ERROR_COPY[e.code];
  if (e instanceof Kcc20TransferError) return e.message;
  return fallback;
}
