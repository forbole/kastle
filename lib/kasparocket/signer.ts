import { blake2b256, decodeAddress, Version } from "@dotk/sdk";
import { schnorrSighash, toSafeJson } from "@dotk/sdk-tx";
import {
  instructionsToSign,
  scriptP2pkh,
  toJsonSafe,
  type Direction,
  type ProtocolInfo,
  type Quote,
  type TransactionPlan,
  type UnsignedTransaction,
} from "@kasparocket/sdk";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "viem";
import { Transaction } from "@/wasm/core/kaspa";
import type { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { splitProgram, successorProgram } from "@/lib/kcc20/standard/program";
import { BORROW_SCHEME, OWNER_SCHEME } from "@/lib/kcc20/standard/state";
import { supportsStandardTransfer } from "@/lib/kcc20/standard/templates";
import { kasparocketPlanToTx } from "./adapter";
import {
  kaspaRocketFeeSompi,
  kaspaRocketFeeSplit,
  kaspaRocketFeesOf,
  kaspaRocketPlanNetworkFee,
  type KaspaRocketFees,
} from "./fees";

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
  /**
   * The SDK client's `protocol()`: read at sign time for the two fee
   * addresses a plan may pay (see `checkPayees`).
   */
  protocol: () => Promise<ProtocolInfo>;
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
 * The most network fee a plan may pay, over all its transactions: 0.3 KAS.
 * A real 160 KAS buy (FOUR, 2026-11-26: one transaction, 8 inputs, two of
 * them covenant cells) pays 0.186583 KAS. The swap screen's Max keeps this
 * same figure back from a KAS budget (`kaspaRocketMaxIn`).
 */
export const KASPAROCKET_NETWORK_FEE_CEILING_SOMPI = 30_000_000n;

/**
 * True when a quote is not worth signing. Fail-closed: a quote the rule
 * cannot read counts as uneconomic.
 *
 * Buy: `netKasSompi` is the KAS leaving the wallet, so it is negative: the
 * budget into the pool plus KaspaRocket's fee on top (real FOUR buy:
 * 160 KAS budget, 159.99997202 KAS into the pool, 3 KAS fee, -162.99997202
 * KAS net). Uneconomic when the quote says so, when no KAS leaves (0n is
 * also what the SDK reads a missing `net_kas_sompi` as), when protocol()'s
 * fee schedule is unknown, or when the outflow is more than the budget the
 * user entered plus the fee that schedule charges on it.
 *
 * Sell: the KAS received, `netKasSompi`, must be positive.
 */
export function kaspaRocketQuoteUneconomic(
  quote: Quote,
  trade: Pick<KaspaRocketTrade, "direction" | "amountIn">,
  fees: KaspaRocketFees | undefined,
): boolean {
  const net = quote.netKasSompi;
  if (quote.uneconomic !== false || typeof net !== "bigint") return true;
  if (trade.direction === "sell") return net <= 0n;
  if (trade.direction !== "buy" || !fees || trade.amountIn <= 0n) return true;
  if (net >= 0n) return true;
  return -net > trade.amountIn + kaspaRocketFeeSompi(trade.amountIn, fees);
}

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

/** A whole token amount from the plan summary: bigint, exact number, or decimal string. */
function tokenAmount(x: unknown): bigint | null {
  if (typeof x === "bigint") return x >= 0n ? x : null;
  if (typeof x === "number")
    return Number.isSafeInteger(x) && x >= 0 ? BigInt(x) : null;
  if (typeof x === "string" && /^(0|[1-9][0-9]*)$/.test(x)) return BigInt(x);
  return null;
}

/**
 * A raw plan output's script, version 0 only, in either wire form: the
 * server's `{ version, script }`, or the safe-JSON hex string with its 2-byte
 * version in front. Anything else is null.
 */
function rawScriptV0(spk: unknown): string | null {
  if (typeof spk === "string") {
    return /^0000([0-9a-f]{2})+$/.test(spk) ? spk.slice(4) : null;
  }
  if (!spk || typeof spk !== "object") return null;
  const { version, script } = spk as { version?: unknown; script?: unknown };
  return version === 0 &&
    typeof script === "string" &&
    /^([0-9a-f]{2})+$/.test(script)
    ? script
    : null;
}

/** 35-byte P2SH: OP_BLAKE2B, a 32-byte script hash, OP_EQUAL. */
const P2SH = /^aa20[0-9a-f]{64}87$/;

/** The data of a signature script's last push; null on any non-push opcode. */
function lastPush(script: Uint8Array): Uint8Array | null {
  let last: Uint8Array | null = null;
  let i = 0;
  while (i < script.length) {
    const op = script[i++];
    let n: number;
    if (op >= 0x01 && op <= 0x4b) n = op;
    else if (op === 0x4c && i + 1 <= script.length) n = script[i++];
    else if (op === 0x4d && i + 2 <= script.length) {
      n = script[i] | (script[i + 1] << 8);
      i += 2;
    } else if (op === 0x4e && i + 4 <= script.length) {
      n =
        (script[i] |
          (script[i + 1] << 8) |
          (script[i + 2] << 16) |
          (script[i + 3] << 24)) >>>
        0;
      i += 4;
    } else return null;
    if (i + n > script.length) return null;
    last = script.subarray(i, i + n);
    i += n;
  }
  return last;
}

const p2shOf = (program: Uint8Array) => `aa20${hex(blake2b256(program))}87`;

/**
 * Whether the plan's bought-token cell holds exactly `amount` of the token,
 * owned by the wallet's key: its P2SH is recomputed here from that state, not
 * read from the summary.
 *
 * The cell's program comes from the token's leader input
 * (`summary.inputs.kcc20Leader`, counted over every transaction's inputs in
 * plan order): the last push of its signature script, accepted only when that
 * input is a coin of `tokenId`, the program hashes to the coin's own P2SH, and
 * its template is one the wallet's KCC-20 transfer builder allowlists
 * (`supportsStandardTransfer`). The cell's expected state is the one that
 * builder writes for a recipient: `amount` to the wallet's x-only key,
 * pay-to-pubkey Schnorr, borrowing disabled, the leader's extension
 * commitment. Its successor program's P2SH must equal the cell's script.
 *
 * What is still the server's word: the leader coin's own script. A coin
 * claimed with another program does not exist on chain under that outpoint,
 * so the network refuses the transaction; no node is asked here.
 */
function userCellBound(
  plan: TransactionPlan,
  tokenId: string,
  xOnlyPk: string,
  cellScript: string,
  amount: bigint,
): boolean {
  const s = (plan.summary ?? {}) as Record<string, unknown>;
  const at = (s.inputs as Record<string, unknown> | undefined)?.kcc20Leader;
  if (!Number.isInteger(at) || (at as number) < 0) return false;
  const inputs = plan.transactions.flatMap(
    ({ tx }) => kasparocketPlanToTx(tx).inputs,
  );
  const leader = inputs[at as number];
  const coin = leader?.utxo;
  if (!coin || coin.covenantId !== tokenId || coin.scriptVersion !== 0)
    return false;
  const program = lastPush(hexToBytes(`0x${leader.signatureScript}`));
  if (!program || p2shOf(program) !== coin.scriptPublicKey) return false;
  if (!supportsStandardTransfer(program)) return false;
  const pk = xOnlyPk.toLowerCase().replace(/^0x/, "");
  const expected = successorProgram(program, {
    amount,
    owner: hexToBytes(`0x${pk}`),
    ownerScheme: OWNER_SCHEME.P2PK_SCHNORR,
    borrowScheme: BORROW_SCHEME.DISABLED,
    borrowGuard: new Uint8Array(32),
    extensionCommitment: splitProgram(program).state.extensionCommitment,
  });
  return p2shOf(expected) === cellScript;
}

/**
 * A buy's token amount. The transaction does not carry it in the clear: the
 * KCC-20 cell the wallet receives (`summary.outputs.kcc20User`) is a covenant
 * output whose `value` is the cell's KAS deposit (2 KAS on the real plan), and
 * whose script is the token covenant's P2SH, not the wallet's pay-to-pubkey.
 * The amount lives in the cell's program state behind that hash. So the
 * amount is the summary's, and only when the transaction has the shape the
 * summary describes: the named output exists, is the token's covenant, sits
 * behind a P2SH, the summary's `amountTokens` and `userTokensAfter` agree,
 * and that P2SH is the one a cell of exactly `amountTokens`, owned by the
 * wallet, hashes to (`userCellBound`). Any mismatch is null.
 *
 * The cell is read from the raw plan, in either `scriptPublicKey` wire form;
 * the leader input through `kasparocketPlanToTx`, as `checkGuard` reads it.
 */
function buyPayout(
  plan: TransactionPlan,
  tokenId: string,
  xOnlyPk: string,
): bigint | null {
  const s = (plan.summary ?? {}) as Record<string, unknown>;
  if (s.direction !== "buy") return null;
  const at = (s.outputs as Record<string, unknown> | undefined)?.kcc20User;
  if (!Number.isInteger(at) || (at as number) < 0) return null;
  const outputs = plan.transactions.flatMap(({ tx }) => {
    const o = (tx as { outputs?: unknown }).outputs;
    if (!Array.isArray(o)) throw new Error("plan transaction has no outputs");
    return o as unknown[];
  });
  const cell = outputs[at as number] as Record<string, unknown> | undefined;
  if (!cell || typeof cell !== "object") return null;
  const covenant = cell.covenant as { covenantId?: unknown } | null | undefined;
  if (covenant?.covenantId !== tokenId) return null;
  const script = rawScriptV0(cell.scriptPublicKey);
  if (script === null || !P2SH.test(script)) return null;
  const amount = tokenAmount(s.amountTokens);
  const after = tokenAmount(s.userTokensAfter);
  if (amount === null || after === null || amount !== after) return null;
  return userCellBound(plan, tokenId, xOnlyPk, script, amount) ? amount : null;
}

/**
 * What the plan pays the wallet. Null when the plan cannot be read, or does
 * not have the shape its payout is read from.
 *
 * Buy: the tokens, from the summary, bound to the bytes: the cell the wallet
 * receives must hash to exactly that amount under the wallet's key (see
 * `buyPayout`); checked against a real `/plan/trade` buy plan.
 *
 * Sell: KAS, read from the transactions, never the summary: the wallet's plain
 * outputs less its plain inputs (`kaspaRocketWalletDebit`, negated), plus the
 * network fee those inputs bore (shown on its own row). Unverified: no server-built sell plan has been checked
 * against this read (none could be built without holding the token).
 */
export function kaspaRocketPlanPayout(
  plan: TransactionPlan,
  tokenId: string,
  xOnlyPk: string,
  direction: Direction,
): bigint | null {
  try {
    if (direction === "buy") return buyPayout(plan, tokenId, xOnlyPk);
  } catch {
    return null;
  }
  const debit = kaspaRocketWalletDebit(plan, xOnlyPk);
  const fee = kaspaRocketPlanNetworkFee(plan);
  return debit === null || fee === undefined ? null : fee - debit;
}

/**
 * What the plan takes from the wallet's KAS, read from the transactions
 * alone: the wallet's own inputs (coins on its pay-to-pubkey) less the
 * wallet's own plain outputs (its pay-to-pubkey, no covenant), over every
 * transaction. Negative when the wallet ends with more KAS (a sell). Null
 * when a transaction cannot be read.
 *
 * The real 160 KAS buy debits 164.18655502 KAS: 159.99997202 into the pool,
 * 2 KAS treasury fee, 2 KAS deposit in the bought-token cell, 0.186583 KAS
 * network fee; its 1 KAS partner fee pays the wallet's own key, so it is no
 * debit.
 */
export function kaspaRocketWalletDebit(
  plan: TransactionPlan,
  xOnlyPk: string,
): bigint | null {
  const own = ownScript(xOnlyPk);
  try {
    let debit = 0n;
    for (const { tx } of plan.transactions) {
      const t = kasparocketPlanToTx(tx);
      for (const i of t.inputs) {
        if (i.utxo!.scriptPublicKey === own) debit += BigInt(i.utxo!.amount);
      }
      for (const o of t.outputs) {
        if (paysOwn(o, own) && o.covenant?.covenantId == null)
          debit -= BigInt(o.value);
      }
    }
    return debit;
  } catch {
    return null;
  }
}

/**
 * The KAS a buy may leave in the bought-token cell, on top of the trade: the
 * real plan's `kcc20User` cell carries 2 KAS. It stays the wallet's (the cell
 * is its own, see `userCellBound`) but is locked in the cell until spent.
 */
export const KASPAROCKET_TOKEN_CELL_DEPOSIT_SOMPI = 200_000_000n;

/**
 * The most a buy may debit the wallet: the budget, what protocol()'s schedule
 * charges on it, the network-fee ceiling and one token-cell deposit. Real
 * buy: 160 + 3 + 0.3 + 2 = 165.3 KAS against a 164.18655502 KAS debit.
 */
export function kaspaRocketMaxBuyDebit(
  budgetSompi: bigint,
  fees: KaspaRocketFees,
): bigint {
  return (
    budgetSompi +
    kaspaRocketFeeSompi(budgetSompi, fees) +
    KASPAROCKET_NETWORK_FEE_CEILING_SOMPI +
    KASPAROCKET_TOKEN_CELL_DEPOSIT_SOMPI
  );
}

/**
 * The version-0 locking script a mainnet address names, as the adapter reads
 * one; null when the value is not such an address.
 */
function mainnetScriptOf(address: unknown): string | null {
  if (typeof address !== "string") return null;
  try {
    const a = decodeAddress(address);
    if (a.prefix !== "kaspa") return null;
    const h = hex(a.payload);
    if (a.version === Version.PubKey) return `20${h}ac`;
    if (a.version === Version.PubKeyECDSA) return `21${h}ab`;
    if (a.version === Version.ScriptHash) return `aa20${h}87`;
    return null;
  } catch {
    return null;
  }
}

/** An output index `summary.outputs` names, or undefined. */
function namedIndex(plan: TransactionPlan, key: string): number | undefined {
  const outs = (plan.summary as Record<string, unknown> | undefined)?.outputs;
  const at = (outs as Record<string, unknown> | null | undefined)?.[key];
  return Number.isInteger(at) && (at as number) >= 0
    ? (at as number)
    : undefined;
}

/**
 * Who a plan may pay, and only these:
 *  - the wallet itself (version-0 pay-to-pubkey on its own key): token change,
 *    KAS change and sale proceeds;
 *  - the pool covenant `lpCovenantId`: KaspaRocket's side of the trade, a
 *    script the covenant itself enforces;
 *  - a token output to that pool output's own script: tokens sold into the
 *    pool's reserve;
 *  - the token covenant's own cells, by index: the output at
 *    `summary.outputs.kcc20Reserve` or `.kcc20User` carrying covenant
 *    `tokenId`, behind a version-0 P2SH (a real buy: the token's reserve
 *    cell, and the cell holding the bought tokens, each behind its own P2SH
 *    that the token covenant checks). Index-driven: a token output at any
 *    other index still refuses, and so does a named one on a plain key;
 *  - the platform fee: the plain output at `summary.outputs.fee`, paying
 *    `protocol().treasuryAddress` exactly `summary.platformFeeSompi`, and no
 *    more than protocol()'s schedule charges the treasury on this trade;
 *  - the partner fee: the plain output at `summary.outputs.partnerFee`, paying
 *    `protocol().partner.feeAddress` exactly `summary.partnerFeeSompi`, and no
 *    more than the schedule's partner cut on this trade.
 * Both fee addresses and the schedule come from the protocol document at sign
 * time, never from this file or the summary: a summary raising its own fee to
 * match a larger fee output still refuses. The trade's KAS size is the buy's
 * budget (what the quote's flow may not exceed), or a sell's KAS flow as the
 * plan states it (a sell's fee comes out of its proceeds, which the payout
 * floor bounds). An unreadable schedule refuses. Anything else refuses.
 *
 * Indexes count over every transaction's outputs in plan order, as
 * `buyPayout` reads `kcc20User`.
 */
function checkPayees(
  plan: TransactionPlan,
  txs: Tx[],
  g: KaspaRocketGuard,
  own: string,
  protocol: ProtocolInfo,
  fees: KaspaRocketFees | undefined,
) {
  const s = (plan.summary ?? {}) as Record<string, unknown>;
  if (!fees) refuse("fee schedule cannot be read");
  const size = g.trade.direction === "buy" ? g.trade.amountIn : planFlow(plan);
  if (size === undefined || size <= 0n) refuse("trade size cannot be read");
  const cap = kaspaRocketFeeSplit(size!, fees!);
  const treasury = mainnetScriptOf(
    (protocol as { treasuryAddress?: unknown }).treasuryAddress,
  );
  const partner = mainnetScriptOf(protocol.partner?.feeAddress);
  const fee = namedIndex(plan, "fee");
  const partnerFee = namedIndex(plan, "partnerFee");
  const tokenCells = new Set(
    [namedIndex(plan, "kcc20Reserve"), namedIndex(plan, "kcc20User")].filter(
      (i) => i !== undefined,
    ),
  );
  /**
   * A plain version-0 output paying `script` no more than the schedule's
   * `most`, and exactly the summary's `amount`.
   */
  const paysFee = (
    o: Tx["outputs"][number],
    script: string | null,
    most: bigint,
    amount: unknown,
  ) =>
    script !== null &&
    o.covenant == null &&
    o.scriptVersion === 0 &&
    o.scriptPublicKey === script &&
    BigInt(o.value) <= most &&
    tokenAmount(amount) === BigInt(o.value);

  const poolScripts = new Set(
    txs.flatMap((t) =>
      t.outputs
        .filter((o) => o.covenant?.covenantId === g.lpCovenantId)
        .map((o) => o.scriptPublicKey),
    ),
  );
  let at = -1;
  for (const t of txs) {
    for (const o of t.outputs) {
      at += 1;
      const id = o.covenant?.covenantId;
      if (id === g.lpCovenantId || paysOwn(o, own)) continue;
      if (id === g.trade.tokenId && poolScripts.has(o.scriptPublicKey))
        continue;
      if (
        id === g.trade.tokenId &&
        tokenCells.has(at) &&
        o.scriptVersion === 0 &&
        P2SH.test(o.scriptPublicKey)
      )
        continue;
      if (at === fee && paysFee(o, treasury, cap.treasury, s.platformFeeSompi))
        continue;
      if (
        at === partnerFee &&
        paysFee(o, partner, cap.partner, s.partnerFeeSompi)
      )
        continue;
      refuse("plan pays an address this wallet cannot spend");
    }
  }
}

/**
 * `checkPayees` on its own, over the plan's transactions as the adapter reads
 * them: throws `KaspaRocketSignRefusal` on a payee outside the list. For
 * specs; `signPlan` runs the same check inside its guard.
 */
export function kaspaRocketCheckPayees(
  plan: TransactionPlan,
  g: KaspaRocketGuard,
  xOnlyPk: string,
  protocol: ProtocolInfo,
): void {
  const txs = plan.transactions.map((p) => kasparocketPlanToTx(p.tx));
  checkPayees(
    plan,
    txs,
    g,
    ownScript(xOnlyPk),
    protocol,
    kaspaRocketFeesOf(toJsonSafe(protocol)),
  );
}

function checkGuard(
  plan: TransactionPlan,
  g: KaspaRocketGuard,
  pk: string,
  protocol: ProtocolInfo,
) {
  const { quote, trade, lpCovenantId, slippageBps } = g;
  if (lpCovenantId == null) refuse("token has no pool");
  const fees = kaspaRocketFeesOf(toJsonSafe(protocol));
  if (kaspaRocketQuoteUneconomic(quote, trade, fees))
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
  checkPayees(plan, txs, g, ownScript(pk), protocol, fees);
  const fee = kaspaRocketPlanNetworkFee(plan);
  if (fee === undefined) refuse("network fee cannot be read");
  if (fee! > KASPAROCKET_NETWORK_FEE_CEILING_SOMPI) {
    refuse(
      `network fee ${fee} sompi is over the ${KASPAROCKET_NETWORK_FEE_CEILING_SOMPI} sompi ceiling`,
    );
  }
  // What leaves the wallet, from the transactions: extra change routed into
  // an allowed covenant output moves neither the quote, the summary nor the
  // network fee. A sell's debit is bounded by its payout floor below.
  if (trade.direction === "buy") {
    const debit = kaspaRocketWalletDebit(plan, pk);
    if (debit === null) refuse("wallet debit cannot be read");
    if (!fees) refuse("fee schedule cannot be read");
    const most = kaspaRocketMaxBuyDebit(trade.amountIn, fees!);
    if (debit! > most) {
      refuse(
        `plan debits ${debit} sompi from the wallet, over the ${most} sompi this buy allows`,
      );
    }
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
 *
 * The server's transaction is not in WASM's safe-JSON form (nested
 * `previousOutpoint`, `{ version, script }` keys), and
 * `deserializeFromSafeJSON` refuses it (``missing field `transactionId` ``).
 * So it goes through the strict reader the digest checks use, then
 * @dotk/sdk-tx's own `toSafeJson`, as `lib/dotk/node.ts` hands a Tx to WASM.
 */
export const kaspaRocketWalletDigest =
  (
    wallet: Pick<IWallet, "signInputDigest">,
    plan: TransactionPlan,
  ): KaspaRocketSignDigest =>
  // async: a transaction the reader refuses rejects, never throws in place.
  async (txIndex, inputIndex) =>
    wallet.signInputDigest(
      Transaction.deserializeFromSafeJSON(
        toSafeJson(kasparocketPlanToTx(plan.transactions[txIndex].tx)),
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
      // Before the TTL check, so a slow protocol() cannot outlast it.
      const protocol = await guard.protocol();
      if ((guard.now ?? Date.now)() - guard.builtAt > KASPAROCKET_PLAN_TTL_MS)
        throw new KaspaRocketPlanExpired();
      const txs = checkGuard(plan, guard, pk, protocol);

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
