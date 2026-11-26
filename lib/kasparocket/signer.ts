import { schnorrSighash } from "@dotk/sdk-tx";
import {
  instructionsToSign,
  scriptP2pkh,
  type Direction,
  type Quote,
  type TransactionPlan,
  type UnsignedTransaction,
} from "@kasparocket/sdk";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "viem";
import { Transaction } from "@/wasm/core/kaspa";
import type { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { kasparocketPlanToTx } from "./adapter";
import { kaspaRocketPlanNetworkFee } from "./fees";

// Ported from mobile lib/kasparocket/signer.ts. One substitution: the popup
// never holds the key, so a signature comes from `signDigest` (the
// background's signInputDigest) instead of a raw key. Every guard below is
// mobile's, in mobile's order; the plan TTL moved here from mobile's hook.

/** A pre-sign check failed: nothing was signed. */
export class KaspaRocketSignRefusal extends Error {
  constructor(message: string) {
    super(`KaspaRocket swap not signed: ${message}`);
    this.name = "KaspaRocketSignRefusal";
  }
}

/** The plan outlived its TTL: build a fresh one, never re-sign this one. */
export class KaspaRocketPlanExpired extends KaspaRocketSignRefusal {
  constructor() {
    super("plan expired, rebuild it");
    this.name = "KaspaRocketPlanExpired";
  }
}

/** Mobile's `useKaspaRocketSwap.ts` plan lifetime. */
export const KASPAROCKET_PLAN_TTL_MS = 30_000;

const refuse = (message: string): never => {
  throw new KaspaRocketSignRefusal(message);
};

const hex = (b: Uint8Array) => bytesToHex(b).slice(2);

const BPS = 10_000n;

/** The trade the user was shown and confirmed. */
export type KaspaRocketTrade = {
  tokenId: string;
  direction: Direction;
  /** Buy: the KAS budget in sompi. Sell: raw token units. */
  amountIn: bigint;
};

/** What a plan must still agree with when it reaches the key. */
export type KaspaRocketGuard = {
  quote: Quote;
  trade: KaspaRocketTrade;
  lpCovenantId: string | null;
  slippageBps: bigint;
  /** When the plan was built, ms since epoch; older than the TTL refuses. */
  builtAt: number;
  /** Clock, for tests. */
  now?: () => number;
};

/** The plan's own statement of the KAS crossing the pool, if it gave one. */
function planFlow(plan: TransactionPlan): bigint | undefined {
  const s = plan.summary ?? {};
  const v = s.kasFlowSompi ?? s.kas_flow_sompi;
  return typeof v === "bigint" ? v : undefined;
}

/**
 * The most network fee a plan may pay, over all its transactions: 0.1 KAS,
 * what the swap screen's Max keeps back from a KAS budget for that fee.
 */
export const KASPAROCKET_NETWORK_FEE_CEILING_SOMPI = 10_000_000n;

/** The wallet's own version-0 pay-to-pubkey script, as the adapter reads one. */
const ownScript = (xOnlyPk: string) =>
  `20${xOnlyPk.toLowerCase().replace(/^0x/, "")}ac`;

type Tx = ReturnType<typeof kasparocketPlanToTx>;
const paysOwn = (o: Tx["outputs"][number], own: string) =>
  o.scriptVersion === 0 && o.scriptPublicKey === own;

/** The least the preview promises: the quote's output less the slippage. */
export function kaspaRocketMinOut(
  quote: Quote,
  direction: Direction,
  slippageBps: bigint,
): bigint {
  const out = direction === "buy" ? quote.amountTokens : quote.netKasSompi;
  return (out * (BPS - slippageBps)) / BPS;
}

/**
 * What the plan pays the wallet, read from its transactions, never from its
 * summary. Buy: the tokens in the token's covenant outputs to the wallet's own
 * script. Sell: KAS, the wallet's plain outputs less its plain inputs, plus
 * the network fee those inputs bore (shown on its own row). Null when the plan
 * cannot be read.
 *
 * Known gap (carried from mobile): a buy reads the token amount from the
 * token output's `value`, which is where the synthetic fixture puts it. No
 * server-built plan has been checked against this, and a standard KCC-20 cell
 * keeps its amount in program state behind P2SH. Check it against a live plan
 * before the flag goes on.
 */
export function kaspaRocketPlanPayout(
  plan: TransactionPlan,
  tokenId: string,
  xOnlyPk: string,
  direction: Direction,
): bigint | null {
  const own = ownScript(xOnlyPk);
  try {
    let paid = 0n;
    for (const { tx } of plan.transactions) {
      const t = kasparocketPlanToTx(tx);
      for (const o of t.outputs) {
        if (!paysOwn(o, own)) continue;
        const id = o.covenant?.covenantId;
        if (direction === "buy" ? id === tokenId : id == null) {
          paid += BigInt(o.value);
        }
      }
      if (direction === "sell") {
        for (const i of t.inputs) {
          if (i.utxo!.scriptPublicKey === own) paid -= BigInt(i.utxo!.amount);
        }
      }
    }
    if (direction === "buy") return paid;
    const fee = kaspaRocketPlanNetworkFee(plan);
    return fee === undefined ? null : paid + fee;
  } catch {
    return null;
  }
}

/**
 * Who a plan may pay. Three destinations, and only these:
 *  - the wallet itself (version-0 pay-to-pubkey on its own key): bought
 *    tokens, token change, KAS change and sale proceeds;
 *  - the pool covenant `lpCovenantId`: KaspaRocket's side of the trade, a
 *    script the covenant itself enforces;
 *  - a token output to that pool output's own script: tokens sold into the
 *    pool's reserve.
 * The SDK (0.1.6) documents no treasury or partner address. A plain output to
 * anything else is refused rather than guessed at: if KaspaRocket pays its
 * treasury in a plain output, every such plan refuses here until that address
 * is documented and named in this list.
 */
function checkPayees(txs: Tx[], g: KaspaRocketGuard, own: string) {
  const poolScripts = new Set(
    txs.flatMap((t) =>
      t.outputs
        .filter((o) => o.covenant?.covenantId === g.lpCovenantId)
        .map((o) => o.scriptPublicKey),
    ),
  );
  for (const t of txs) {
    for (const o of t.outputs) {
      const id = o.covenant?.covenantId;
      if (id === g.lpCovenantId || paysOwn(o, own)) continue;
      if (id === g.trade.tokenId && poolScripts.has(o.scriptPublicKey))
        continue;
      refuse("plan pays an address this wallet cannot spend");
    }
  }
}

function checkGuard(plan: TransactionPlan, g: KaspaRocketGuard, pk: string) {
  const { quote, trade, lpCovenantId, slippageBps } = g;
  if (lpCovenantId == null) refuse("token has no pool");
  if (quote.uneconomic || quote.netKasSompi <= 0n)
    refuse("quote is uneconomic");
  if (
    quote.direction !== trade.direction ||
    (trade.direction === "sell" && quote.amountTokens !== trade.amountIn)
  ) {
    refuse("plan does not match the quoted trade");
  }
  if (plan.networkId !== "mainnet")
    refuse("plan does not match the quoted trade");
  // A swap leaves nothing resting on the book.
  if (plan.order_row != null) refuse("plan places an order");
  if (!plan.transactions?.length) refuse("plan has no transaction");

  // Every covenant the plan's outputs carry is the token's or its pool's,
  // and the pool is one of them: a plan for another market reads otherwise.
  let touchesPool = false;
  const txs = plan.transactions.map((p) => kasparocketPlanToTx(p.tx));
  for (const tx of txs) {
    for (const o of tx.outputs) {
      const id = o.covenant?.covenantId;
      if (id == null) continue;
      if (id === lpCovenantId) touchesPool = true;
      else if (id !== trade.tokenId)
        refuse("plan does not match the quoted trade");
    }
  }
  if (!touchesPool) refuse("plan does not match the quoted trade");

  if (slippageBps < 0n || slippageBps >= BPS) refuse("slippage out of range");
  if (kaspaRocketPriceMoved(plan, quote, trade.direction, slippageBps)) {
    refuse("price moved beyond slippage");
  }
  checkPayees(txs, g, ownScript(pk));
  const fee = kaspaRocketPlanNetworkFee(plan);
  if (fee === undefined) refuse("network fee cannot be read");
  if (fee! > KASPAROCKET_NETWORK_FEE_CEILING_SOMPI) {
    refuse(
      `network fee ${fee} sompi is over the ${KASPAROCKET_NETWORK_FEE_CEILING_SOMPI} sompi ceiling`,
    );
  }
  // Both sides: what the plan pays out, never less than the preview's floor.
  const paid = kaspaRocketPlanPayout(plan, trade.tokenId, pk, trade.direction);
  if (
    paid === null ||
    paid < kaspaRocketMinOut(quote, trade.direction, slippageBps)
  ) {
    refuse("plan pays less than the minimum shown");
  }
  return txs;
}

/**
 * True when the plan's KAS flow is worse than the quote by more than the
 * slippage, or the plan states none. Buy: KAS into the pool may not exceed
 * the quote by more. Sell: KAS out of the pool may not fall below it.
 */
export function kaspaRocketPriceMoved(
  plan: TransactionPlan,
  quote: Quote,
  direction: Direction,
  slippageBps: bigint,
): boolean {
  const flow = planFlow(plan);
  if (flow === undefined) return true;
  return direction === "buy"
    ? flow * BPS > quote.kasFlowSompi * (BPS + slippageBps)
    : flow * BPS < quote.kasFlowSompi * (BPS - slippageBps);
}

/** 65 bytes: a 64-byte Schnorr signature and its SIGHASH_ALL type byte. */
export type KaspaRocketSignDigest = (
  txIndex: number,
  inputIndex: number,
) => Promise<Uint8Array>;

/**
 * The popup's `signDigest` for `plan`: the planned transaction as WASM, its
 * input signed by the background, as `lib/kasseal/sign.ts` does. The digest
 * WASM signs is checked against the dotk one by the signer, after the fact.
 */
export const kaspaRocketWalletDigest =
  (
    wallet: Pick<IWallet, "signInputDigest">,
    plan: TransactionPlan,
  ): KaspaRocketSignDigest =>
  (txIndex, inputIndex) =>
    wallet.signInputDigest(
      Transaction.deserializeFromSafeJSON(
        JSON.stringify(plan.transactions[txIndex].tx),
      ),
      inputIndex,
    );

/**
 * Signs a KaspaRocket plan with a Kastle account, and is the only way this
 * extension signs one: it is not an SDK `Signer`, so `signAndSubmit` cannot
 * reach the wallet around the guard. Before any signature is asked for,
 * `signPlan` refuses an expired plan, checks the plan against the quote and
 * trade in `guard`, and every input it signs against its locally recomputed
 * v1 SIGHASH_ALL digest, which must equal the server's. Only the wallet's own
 * p2pkh inputs are signed; a plan asking for a covenant signature is refused.
 * Each signature must verify against the dotk digest under the wallet key, or
 * the plan refuses. Answers the plan's transactions, signed, in submit order.
 */
export function kastleKaspaRocketSigner(
  signDigest: KaspaRocketSignDigest,
  xOnlyPk: string,
  guard: KaspaRocketGuard,
) {
  const pk = xOnlyPk.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(pk))
    refuse("public key is not 32-byte x-only hex");

  return {
    async signPlan(plan: TransactionPlan): Promise<UnsignedTransaction[]> {
      if ((guard.now ?? Date.now)() - guard.builtAt > KASPAROCKET_PLAN_TTL_MS)
        throw new KaspaRocketPlanExpired();
      const txs = checkGuard(plan, guard, pk);

      const work = plan.transactions.map((planned, t) => {
        const tx = txs[t];
        if (tx.version !== 1)
          refuse(`transaction version ${tx.version}, not 1`);
        const todo = instructionsToSign(planned);
        if (!todo.length) refuse(`transaction ${t} asks for no signature`);
        const seen = new Set<number>();
        const digests = todo.map((ins) => {
          const i = ins.inputIndex;
          if (ins.kind !== "p2pkh") refuse(`input ${i} is a covenant input`);
          if (seen.has(i)) refuse(`input ${i} is listed twice`);
          seen.add(i);
          if (!Number.isInteger(i) || i < 0 || i >= tx.inputs.length) {
            refuse(`input ${i} is not in the transaction`);
          }
          if (tx.inputs[i].signatureScript !== "")
            refuse(`input ${i} is not blank`);
          const digest = schnorrSighash(tx, i);
          const prepared = ins.sighash;
          if (
            typeof prepared !== "string" ||
            prepared.toLowerCase() !== hex(digest)
          ) {
            refuse(`input ${i} sighash does not match the prepared one`);
          }
          return { i, digest };
        });
        return { t, planned, digests };
      });

      const signed: UnsignedTransaction[] = [];
      for (const { t, planned, digests } of work) {
        const inputs = (planned.tx.inputs as Record<string, unknown>[]).map(
          (input) => ({ ...input }),
        );
        for (const { i, digest } of digests) {
          const sig = await signDigest(t, i);
          if (sig.length !== 65 || sig[64] !== 0x01)
            refuse(`input ${i} signature is not 64 bytes and SIGHASH_ALL`);
          const sig65 = hex(sig);
          // The background hashed the WASM view of the transaction; this
          // check against the dotk digest is what catches a disagreement.
          if (!schnorr.verify(sig65.slice(0, 128), digest, pk)) {
            refuse(`input ${i} signature does not verify under the wallet key`);
          }
          inputs[i].signatureScript = scriptP2pkh(sig65);
        }
        signed.push({ ...planned.tx, inputs });
      }
      return signed;
    },
  };
}
