import {
  buyQuote,
  createApiSources,
  createTxBuilder,
  errorCode,
  finalize,
  launchProofFromJson,
  minWithSlippage,
  sellQuote,
  xOnlyKeyOfAddress,
} from "@kassealhq/sdk";
import type { BuiltTx, KassealNetwork } from "@kassealhq/sdk";
import type {
  KassealQuoteClient,
  KassealQuoteRequest,
} from "@/hooks/swap/useKassealSwap";
import { initKasseal, KassealReloadRequired } from "./init";
import {
  KassealApiError,
  fetchLaunchProof,
  fetchServerQuote,
  fetchTxStatus,
  kassealBaseUrl,
  kassealNetworkOf,
  postTx,
} from "./api";
import {
  KASSEAL_ERRORS as E,
  KASSEAL_MAX_SLIPPAGE_BPS,
  kassealSlippageBps,
  type KassealPreview,
} from "./prepared";
import {
  KassealTradeError,
  requireBoundProof,
  type KassealBuilder,
  type KassealSubmissionDeps,
} from "./trade";

// Mobile's kassealBuild (components/kaspa-signer/kasseal-page-source.ts),
// without the WebView: the popup loads the SDK itself. A quote is a full
// build reconciled against the wallet; the preview is read off that tx.

type BuyOrder = Parameters<KassealBuilder["buildBuy"]>[0];
type SellOrder = Parameters<KassealBuilder["buildSell"]>[0];

/** What a confirm rebuilds under: the quote's own order and bounds. */
type BuildContext = {
  network: KassealNetwork;
  apiUrl: string;
  tokenId: string;
  curveId: string;
  side: "buy" | "sell";
  xHex: string;
  s0: bigint;
  lots: bigint;
  order: BuyOrder | SellOrder;
  /** What the curve is paid (buy) or pays net (sell); a rebuild must match it. */
  paid: bigint;
  /** Buy only: the wallet debit the preview showed, the rebuild's maxAllIn. */
  cap?: bigint;
};

// Bounded: 16 recent quotes, enough for SWR's per-amount cache on one screen.
const MAX_CONTEXTS = 16;
const contexts = new Map<string, BuildContext>();

const keyOf = (r: {
  network?: string;
  covenantId?: string;
  side: string;
  amountIn: bigint;
  slippageBps: number;
  trader?: string;
}) =>
  [r.network, r.covenantId, r.side, r.amountIn, r.slippageBps, r.trader].join(
    "|",
  );

const failed = (why?: string) =>
  new Error(why ? `${E.BUILD_FAILED}:${why}` : E.BUILD_FAILED);
const unusable = (why: string) =>
  Object.assign(new Error(why), { unusable: why });
const unreconciled = () =>
  Object.assign(new Error("unreconciled"), { unreconciled: true });

/** An api.ts read that failed: HTTP status or no answer, never a refusal. */
const transport = (cls: string) => (e: unknown) => {
  throw failed(
    e instanceof KassealApiError ? `HTTP_${e.status}:${cls}` : `NET:${cls}`,
  );
};

/** A non-negative integer as the proof or tx JSON carries it. */
function amt(v: unknown): bigint {
  if (
    !(
      typeof v === "bigint" ||
      (typeof v === "number" && Number.isSafeInteger(v)) ||
      (typeof v === "string" && /^[0-9]+$/.test(v))
    )
  )
    throw new Error("param");
  const r = BigInt(v);
  if (r < 0n) throw new Error("param");
  return r;
}

const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** SDK sources and builder over one read path that remembers its last failure. */
function openBuilder(
  ctx: Pick<BuildContext, "network" | "apiUrl" | "tokenId" | "xHex">,
  required?: ReadonlySet<string>,
) {
  let reason: string | undefined;
  const net: typeof fetch = async (input, init) => {
    try {
      const res = await fetch(input, init);
      reason = res.ok ? undefined : `HTTP_${res.status}:SDK`;
      return res;
    } catch (e) {
      reason = "NET:SDK";
      throw e;
    }
  };
  const sources = createApiSources({
    baseUrl: ctx.apiUrl,
    network: ctx.network,
    tokenId: ctx.tokenId,
    ownKey: ctx.xHex,
    fetch: net,
  });
  const builder = createTxBuilder({
    sources,
    networkId: ctx.network,
    ...(required ? { fundingOptions: { required } } : {}),
  });
  return {
    builder: builder as KassealBuilder,
    sources,
    lastFunding: sources.lastFunding,
    reason: () => reason,
  };
}

/**
 * Every input and output attributed by script, as mobile's readBuilt: the
 * curve cell bound to curveId, this token's cells, the wallet's own P2PK,
 * anything else paid away. The tx must balance against its own fee.
 */
function readBuilt(b: BuiltTx, c: BuildContext) {
  try {
    if (!b.inputsToSign.length) throw new Error("read");
    const tx = JSON.parse(b.txJson) as {
      inputs: { utxo: Record<string, unknown> }[];
      outputs: Record<string, any>[];
    };
    const own = (s: unknown) =>
      typeof s === "string" &&
      (s.toLowerCase() === `20${c.xHex}ac` ||
        s.toLowerCase() === `000020${c.xHex}ac`);
    let totalIn = 0n;
    let totalOut = 0n;
    let walletIn = 0n;
    let change = 0n;
    let outside = 0n;
    let tokenIn = 0n;
    let tokenOut = 0n;
    let curveIn = 0n;
    let curveOut = 0n;
    let curveIns = 0;
    let curveOuts = 0;
    let supplyIns = 0;
    const ownIdx: number[] = [];
    const signed = new Set(b.inputsToSign.map((s) => s.index));
    tx.inputs.forEach((x, i) => {
      const v = amt(x.utxo.amount);
      totalIn += v;
      const cov = x.utxo.covenantId;
      if (cov === c.curveId) {
        curveIns++;
        curveIn = v;
      } else if (cov === c.tokenId) {
        // Every curve trade spends the curve's own supply cell of this token
        // (a buy carves the lots out of it, a sell returns them to it). The
        // wallet never signs that cell; a token cell it would sign is its own,
        // and only a sell may spend one.
        if (signed.has(i)) {
          if (c.side !== "sell") throw unreconciled();
        } else supplyIns++;
        tokenIn += v;
      } else if (typeof cov === "string" && cov) throw unreconciled();
      else if (own(x.utxo.scriptPublicKey)) {
        walletIn += v;
        ownIdx.push(i);
      } else throw unreconciled();
    });
    tx.outputs.forEach((o) => {
      const v = amt(o.value);
      totalOut += v;
      const cov = o.covenant?.covenantId;
      if (cov === c.curveId) {
        curveOuts++;
        curveOut = v;
      } else if (cov === c.tokenId) tokenOut += v;
      else if (typeof cov === "string" && cov) throw unreconciled();
      else if (own(o.scriptPublicKey)) change += v;
      else outside += v;
    });
    const p2pk = b.inputsToSign
      .filter((s) => s.kind === "p2pk")
      .map((s) => s.index)
      .sort((a, z) => a - z);
    const opt = b.optimistic?.curve;
    if (
      curveIns !== 1 ||
      curveOuts !== 1 ||
      (c.side === "buy" && supplyIns !== 1) ||
      supplyIns > 1 ||
      totalIn - totalOut !== amt(b.feeSompi) ||
      p2pk.join() !== ownIdx.join() ||
      !opt ||
      opt.covenantId !== c.curveId ||
      amt(opt.amount) !== curveOut ||
      !opt.state ||
      opt.state.lotsSold !==
        (c.side === "buy" ? c.s0 + c.lots : c.s0 - c.lots) ||
      (c.side === "buy" ? walletIn - change <= 0n : change - walletIn <= 0n)
    )
      throw unreconciled();
    return {
      debit: walletIn - change,
      tokenDelta: tokenIn - tokenOut,
      paid:
        c.side === "buy"
          ? curveOut - curveIn + outside
          : curveIn - curveOut - outside,
    };
  } catch (e) {
    throw (e as { unreconciled?: true })?.unreconciled ? e : unusable("DEBIT");
  }
}

const buildOrder = (builder: KassealBuilder, c: BuildContext) =>
  c.side === "buy"
    ? builder.buildBuy(c.order as BuyOrder)
    : builder.buildSell(c.order as SellOrder);

/** Mobile's kassealBuild: refuses with `KASSEAL_<CODE>[:DETAIL]`. */
export const kassealQuoteClient: KassealQuoteClient = async (req) => {
  const { apiUrl, network, covenantId: tokenId, side, amountIn, trader } = req;
  const { slippageBps } = req;
  await initKasseal(network).catch((e) => {
    throw e instanceof KassealReloadRequired ? e : new Error(E.UNAVAILABLE);
  });
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > KASSEAL_MAX_SLIPPAGE_BPS
  )
    throw new Error(E.SLIPPAGE);
  let xOnly: Uint8Array;
  try {
    xOnly = xOnlyKeyOfAddress(trader);
  } catch {
    throw new Error(E.BAD_PARAMS);
  }
  if (amountIn <= 0n || xOnly.length !== 32 || !tokenId)
    throw new Error(E.BAD_PARAMS);

  // Launch proof: trusted only on a bound verdict for this very token.
  const json = await fetchLaunchProof(apiUrl, tokenId).catch(
    transport("PROOF"),
  );
  let curveId: string;
  try {
    const proof = requireBoundProof(json, network, tokenId);
    // No pool path until a Kasseal pool exists to reconcile against.
    if (proof.poolId) throw new Error(E.NO_POOL);
    curveId = proof.curveId;
  } catch (e) {
    if (e instanceof KassealTradeError)
      throw failed(
        e.code === "wrong-token" ? "WRONG_TOKEN" : "PROOF_NOT_BOUND",
      );
    throw (e as Error)?.message === E.NO_POOL ? e : failed();
  }
  let curve: { p0: bigint; k: bigint; feeBps: bigint; curveLots: bigint };
  let lot: bigint;
  try {
    const q = launchProofFromJson(json).params ?? {};
    curve = {
      p0: amt(q.p0),
      k: amt(q.k),
      feeBps: amt(q.feeBps),
      curveLots: amt(q.curveLots),
    };
    lot = amt(q.lot);
  } catch {
    throw new Error(`${E.CURVE_UNUSABLE}:PARAMS`);
  }
  if (
    lot <= 0n ||
    curve.p0 <= 0n ||
    curve.curveLots <= 0n ||
    curve.feeBps >= 10000n ||
    !curveId
  )
    throw new Error(`${E.CURVE_UNUSABLE}:PARAMS`);

  const base = { network, apiUrl, tokenId, xHex: toHex(xOnly) };
  const open = openBuilder(base);
  try {
    // A head that can't be fetched may clear (retried); one that reads wrong can't.
    const head = await Promise.resolve()
      .then(() => open.sources.curveHead(curveId))
      .catch(() => {
        throw failed("HEAD_FETCH");
      });
    const s0 = head?.state?.lotsSold;
    if (typeof s0 !== "bigint" || s0 < 0n || s0 > curve.curveLots)
      throw unusable("HEAD");

    let lots: bigint;
    let quoted: bigint;
    let tradingFee: bigint;
    if (side === "buy") {
      // Most whole lots whose cost + curve fee fits the KAS typed.
      const totalOf = (n: bigint) => {
        const r = buyQuote(curve, s0, n);
        return r.cost + r.fee;
      };
      let lo = 0n;
      let hi = curve.curveLots - s0;
      if (hi === 0n) throw failed("SOLD_OUT");
      while (lo < hi) {
        const mid = (lo + hi + 1n) / 2n;
        if (totalOf(mid) <= amountIn) lo = mid;
        else hi = mid - 1n;
      }
      lots = lo;
      if (lots === 0n) throw failed("ZERO_LOTS");
      const r = buyQuote(curve, s0, lots);
      quoted = r.cost + r.fee;
      tradingFee = r.fee;
    } else {
      lots = amountIn / lot;
      if (lots === 0n) throw failed("ZERO_LOTS");
      const r = sellQuote(curve, s0, lots);
      // Net to the seller computed here, not read off Quote.total.
      quoted = r.cost - r.fee;
      tradingFee = r.fee;
      if (quoted <= 0n) throw failed();
    }
    // The server's own quote (buy total = cost + fee, sell total = cost − fee):
    // a cross-check only, never a build input. Disagreeing means the head moved.
    const server = await fetchServerQuote(apiUrl, tokenId, side, lots).catch(
      transport("QUOTE"),
    );
    if (server.feeSompi !== tradingFee || server.totalSompi !== quoted)
      throw failed("QUOTE_MOVED");

    const common = {
      covenantId: curveId,
      expectedCurveId: curveId,
      tokenId,
      lots,
      proofVerdict: "bound" as const,
    };
    const ctx: BuildContext = {
      ...base,
      curveId,
      side,
      s0,
      lots,
      paid: quoted,
      order: undefined as never,
    };
    let built: BuiltTx;
    let preview: KassealPreview;
    if (side === "buy") {
      // A curve buy delivers exactly lots × lot; maxKasIn bounds the price
      // moving under us at the quote plus the user's slippage.
      const order: BuyOrder = {
        ...common,
        buyer: trader,
        buyerXOnlyPubkey: xOnly,
        maxKasIn: quoted + (quoted * BigInt(slippageBps) + 9999n) / 10000n,
      };
      // The full debit (price + token cell + network fee) is read off one
      // build, then capped: the held order is maxAllIn = that figure.
      // Two builds per quote, one if the SDK ever returns allIn.
      ctx.order = order;
      const cap = readBuilt(await open.builder.buildBuy(order), ctx).debit;
      ctx.order = { ...order, maxAllIn: cap };
      ctx.cap = cap;
      built = await open.builder.buildBuy(ctx.order as BuyOrder);
      const read = readBuilt(built, ctx);
      if (read.debit > cap) throw unusable("DEBIT");
      if (read.paid !== quoted) throw failed("QUOTE_MOVED");
      preview = {
        side,
        amountIn: quoted.toString(),
        walletDebitSompi: read.debit.toString(),
        minOut: (lots * lot).toString(),
        expectedOut: (lots * lot).toString(),
        feeSompi: BigInt(built.feeSompi).toString(),
        tradingFeeSompi: tradingFee.toString(),
      };
    } else {
      const minOut = minWithSlippage(quoted, slippageBps);
      ctx.order = {
        ...common,
        seller: trader,
        sellerXOnlyPubkey: xOnly,
        minNetOut: minOut,
        expectedTokens: lots * lot,
      };
      built = await open.builder.buildSell(ctx.order as SellOrder);
      const read = readBuilt(built, ctx);
      if (read.paid !== quoted) throw failed("QUOTE_MOVED");
      // The wallet receives the net payout less the network fee, plus what
      // its token cells gave up (or less what they took on).
      const credit = -read.debit;
      if (credit !== quoted - BigInt(built.feeSompi) + read.tokenDelta)
        throw unreconciled();
      preview = {
        side,
        amountIn: (lots * lot).toString(),
        tokenCellSompi: read.tokenDelta.toString(),
        walletCreditSompi: credit.toString(),
        minOut: minOut.toString(),
        expectedOut: quoted.toString(),
        feeSompi: BigInt(built.feeSompi).toString(),
        tradingFeeSompi: tradingFee.toString(),
      };
    }
    if (
      !built.inputsToSign?.length ||
      (built.produces ?? []).some((o) => o?.role === "pool")
    )
      throw unusable("BUILD");

    const key = keyOf(req);
    contexts.delete(key);
    contexts.set(key, ctx);
    while (contexts.size > MAX_CONTEXTS)
      contexts.delete(contexts.keys().next().value!);
    return preview;
  } catch (e) {
    const err = e as {
      unreconciled?: true;
      unusable?: string;
      message?: string;
    };
    if (err?.unreconciled) throw new Error(E.PREVIEW_UNRECONCILED);
    if (err?.unusable) throw new Error(`${E.CURVE_UNUSABLE}:${err.unusable}`);
    if (String(err?.message).startsWith("KASSEAL_")) throw e;
    // A failed read wins; else the SDK's own SCREAMING_CASE code.
    const why = open.reason();
    if (why) throw failed(why);
    const code = errorCode(e);
    throw failed(code && /^[A-Z_]+$/.test(code) ? code : undefined);
  }
};

/** The screen's current Kasseal trade, as it hands useKassealSwap. */
export type KassealTradeRequest = {
  /** Settings network id. */
  network: string;
  covenantId?: string;
  side: "buy" | "sell";
  amountIn: bigint;
  /** Percent, as the hook takes it. */
  slippage: number;
  trader?: string;
};

/**
 * The SDK builder and /tx pieces trade.ts runs. A confirm rebuilds the order
 * the shown preview was quoted under (its maxAllIn / minNetOut), on the
 * pinned coins, and refuses a tx that pays the curve other than the preview.
 */
export function kassealTradeDeps(
  r: KassealTradeRequest,
): Omit<KassealSubmissionDeps, "sign" | "persist"> {
  const net = kassealNetworkOf(r.network);
  const base = net ? kassealBaseUrl(net) : "";
  const context = () => {
    const c = contexts.get(
      keyOf({
        ...r,
        network: net,
        slippageBps: kassealSlippageBps(r.slippage),
      }),
    );
    if (!c) throw failed("QUOTE_MOVED");
    return c;
  };
  return {
    makeBuilder: (required) => {
      const { builder, lastFunding } = openBuilder(context(), required);
      return { builder, lastFunding };
    },
    build: async (builder) => {
      const c = context();
      const built = await buildOrder(builder, c);
      let read: ReturnType<typeof readBuilt>;
      try {
        read = readBuilt(built, c);
      } catch {
        throw failed("QUOTE_MOVED");
      }
      if (read.paid !== c.paid || (c.cap !== undefined && read.debit > c.cap))
        throw failed("QUOTE_MOVED");
      return built;
    },
    post: async (signed) => {
      const final = await finalize(signed, signed.txJson);
      if (final.txid !== signed.txid) throw new Error("finalized txid moved");
      return postTx(base, final.txid, final.txJson);
    },
    status: (txid) => fetchTxStatus(base, txid),
  };
}
