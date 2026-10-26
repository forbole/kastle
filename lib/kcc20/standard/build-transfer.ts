import { spend } from "@kronsdk/kron-sdk";
import { schnorrSighash, type Tx } from "@dotk/sdk-tx";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import {
  payToScriptHashScript,
  RpcClient,
  Transaction,
} from "@/wasm/core/kaspa";
import { classifyRedeem, isStandardOwnedBy } from "../classify";
import {
  BuiltKcc20Transfer,
  fundCovenantSpend,
  recipientPubkey,
} from "../transfer";
import { bytesEqual, pushExplicit, pushMinimal } from "./primitives";
import {
  BORROW_SCHEME,
  encodeState,
  encodeTransferArgs,
  KCC20State,
  OWNER_SCHEME,
  STATE_LEN,
  TRANSFER_DELEGATOR_TAG,
} from "./state";
import { supportsStandardTransfer } from "./templates";
import {
  MAX_TOKEN_INPUTS,
  MAX_TOKEN_OUTPUTS,
  validateStandardTransfer,
  WITNESS_PATH,
} from "./validate";

// Wired into the KCC-20 send screen through buildKcc20Transfer. Builds a KCC-20 standard `transfer`: token cells
// first (leader = input 0, delegators after), funding after, continuations bound to the leader.
// Each seat's owner signature sits inside its witness push, so seats are built with a 65-byte
// zero placeholder, the transaction is funded at its final size, then each seat is signed over
// its SIGHASH_ALL digest and the placeholder is overwritten in place at a computed offset.

export const SIG_LEN = 65;
// Decision, not an assumption: every seat signs SIGHASH_ALL. checkSig honours the type in the
// signature's last byte, so anything weaker would leave outputs rewritable.
export const SIGHASH_ALL = 0x01;

// Token cells are laid out before funding, so the lowest covenant-family input is input 0.
export const LEADER_INDEX = 0;

// Compute budget (rusty-kaspa a41a333, consensus/core/src/mass/units.rs). A v1 input may run
// `computeBudget × 10,000 + 9,999` script units; one signature check costs mass_per_sig_op
// (1,000 g) × 100 units/g. Data pushes are free, every other opcode costs.
export const SCRIPT_UNITS_PER_COMPUTE_UNIT = 10_000;
export const FREE_SCRIPT_UNITS_PER_INPUT = SCRIPT_UNITS_PER_COMPUTE_UNIT - 1;
export const SIGOP_SCRIPT_UNITS = 100_000;

export const allowedScriptUnits = (computeBudget: number) =>
  computeBudget * SCRIPT_UNITS_PER_COMPUTE_UNIT + FREE_SCRIPT_UNITS_PER_INPUT;

/** Smallest budget whose allowance covers `sigChecks` signature checks plus `otherUnits`. */
export function computeBudgetFor(sigChecks: number, otherUnits: number) {
  const units = sigChecks * SIGOP_SCRIPT_UNITS + otherUnits;
  return Math.ceil(
    Math.max(0, units - FREE_SCRIPT_UNITS_PER_INPUT) / SCRIPT_UNITS_PER_COMPUTE_UNIT,
  );
}

// Each seat checks only its own owner signature; delegators verify themselves, the leader
// only introspects them. The rest of the program is introspection and arithmetic: kascov
// preflight measured at most 103,319 units of it (leader over three cells), so 400,000 is ~4×.
export const SEAT_SIG_CHECKS = 1;
export const SEAT_SCRIPT_HEADROOM = 400_000;
export const SEAT_COMPUTE_BUDGET = computeBudgetFor(SEAT_SIG_CHECKS, SEAT_SCRIPT_HEADROOM);

// P2PK funding: two free pushes and one OP_CHECKSIG, 100,001 units measured. The free
// allowance is the headroom; this lands on the SDK's FUNDING_COMPUTE (10).
export const FUNDING_SIG_CHECKS = 1;
export const FUNDING_SCRIPT_UNITS = 1;
export const FUNDING_COMPUTE_BUDGET = computeBudgetFor(
  FUNDING_SIG_CHECKS,
  FUNDING_SCRIPT_UNITS,
);

// `6b` OP_TOALTSTACK + `20 <template_hash:32>`: the artifact's state_span starts at 1 and its
// first field is the template hash, so the KCC20State record spans R[34:146].
export const PROGRAM_PREFIX_LEN = 34;
const STATE_END = PROGRAM_PREFIX_LEN + STATE_LEN;
const TAG_PUSH_LEN = 1 + TRANSFER_DELEGATOR_TAG.length;

export class Kcc20StandardBuildError extends Error {
  constructor(
    readonly code:
      | "invalid-amount"
      | "insufficient-balance"
      | "fragmented"
      | "not-standard"
      | "not-owned"
      | "unsupported-template"
      | "mixed-template"
      | "rule-violation"
      | "layout"
      | "bad-signature",
    message: string,
  ) {
    super(message);
  }
}

/** A standard cell to spend: kascov's program bytes plus the node-held outpoint and value. */
export type StandardSpendPiece = {
  outpoint: { transactionId: string; index: number };
  value: bigint;
  redeem: Uint8Array;
};

export type ProgramParts = {
  prefix: Uint8Array;
  state: KCC20State;
  suffix: Uint8Array;
  templateHash: string;
};

/** Split a consumed program `R = R[0:34] || R[34:146] || R[146:]`; refuses anything else. */
export function splitProgram(R: Uint8Array): ProgramParts {
  const c = classifyRedeem(R);
  if (c.family !== "kcc20-standard" || c.stateOffset !== PROGRAM_PREFIX_LEN) {
    throw new Kcc20StandardBuildError(
      "not-standard",
      c.family === "unknown" ? c.reason : `not a standard program (${c.family})`,
    );
  }
  return {
    prefix: R.slice(0, PROGRAM_PREFIX_LEN),
    state: c.state,
    suffix: R.slice(STATE_END),
    templateHash: c.templateHash,
  };
}

/** Successor `R' = R[0:34] || encodeState(next) || R[146:]`: same length, same template hash. */
export function successorProgram(R: Uint8Array, next: KCC20State): Uint8Array {
  const { prefix, suffix } = splitProgram(R);
  const successor = concatBytes(prefix, encodeState(next), suffix);
  if (
    successor.length !== R.length ||
    !bytesEqual(successor.subarray(2, PROGRAM_PREFIX_LEN), R.subarray(2, PROGRAM_PREFIX_LEN))
  ) {
    throw new Kcc20StandardBuildError(
      "layout",
      "successor program changed length or template hash",
    );
  }
  return successor;
}

/** Owner authorization with a zero signature; leader witnesses carry the path byte. */
export function ownerWitnessPlaceholder(
  state: KCC20State,
  pubkey32: Uint8Array,
  leader: boolean,
): Uint8Array {
  const path = leader ? Uint8Array.of(WITNESS_PATH.TRANSFER) : new Uint8Array();
  const sig = new Uint8Array(SIG_LEN);
  switch (state.ownerScheme) {
    case OWNER_SCHEME.P2PK_SCHNORR:
      return concatBytes(path, sig);
    case OWNER_SCHEME.P2PKH_SCHNORR:
      return concatBytes(path, pubkey32, sig);
    default:
      throw new Kcc20StandardBuildError(
        "not-owned",
        `owner_scheme ${state.ownerScheme} is not signable by a Schnorr hot wallet`,
      );
  }
}

export type Seat = {
  inputIndex: number;
  script: Uint8Array;
  // Where the 65-byte signature starts inside `script`.
  sigOffset: number;
};

// The witness is always the push right before the 5-byte dispatch-tag push, and the
// signature is always the last 65 bytes of the witness, whatever the scheme.
function seat(inputIndex: number, args: Uint8Array, R: Uint8Array): Seat {
  return {
    inputIndex,
    script: concatBytes(args, pushMinimal(R)),
    sigOffset: args.length - TAG_PUSH_LEN - SIG_LEN,
  };
}

/** `PushArguments(next_states, witness) || 04 79c71c23 || PushMinimal(R)`. */
export function encodeLeaderSeat(
  inputIndex: number,
  nextStates: KCC20State[],
  witness: Uint8Array,
  R: Uint8Array,
): Seat {
  return seat(inputIndex, encodeTransferArgs(nextStates, witness), R);
}

/** `PushArguments(witness) || 04 fd3ef14a || PushMinimal(R)`; no path byte in the witness. */
export function encodeDelegatorSeat(
  inputIndex: number,
  witness: Uint8Array,
  R: Uint8Array,
): Seat {
  return seat(
    inputIndex,
    concatBytes(pushMinimal(witness), pushExplicit(TRANSFER_DELEGATOR_TAG)),
    R,
  );
}

/** Overwrite the zero placeholder; refuses a seat that is not a placeholder at `sigOffset`. */
export function patchSeat(s: Seat, sig: Uint8Array): Uint8Array {
  if (sig.length !== SIG_LEN) throw new Error("signature must be 65 bytes");
  const at = s.script.subarray(s.sigOffset, s.sigOffset + SIG_LEN);
  if (at.some((b) => b !== 0)) throw new Error("no placeholder at sigOffset");
  const out = s.script.slice();
  out.set(sig, s.sigOffset);
  return out;
}

/** Reject a family the standard program would reject, before anything is signed. */
export function assertFamilyRules(
  consumed: KCC20State[],
  nextStates: KCC20State[],
  leaderWitness: Uint8Array,
) {
  const v = validateStandardTransfer({
    inputs: consumed,
    nextStates,
    witness: leaderWitness,
  });
  if (!v.ok) {
    throw new Kcc20StandardBuildError("rule-violation", `${v.code}: ${v.reason}`);
  }
}

/** Largest first, at most MAX_TOKEN_INPUTS, only cells this key can authorize. */
export function selectStandardPieces<P extends { program: ProgramParts }>(
  parts: P[],
  pubkey32: Uint8Array,
  amount: bigint,
): P[] {
  const owned = parts
    .filter((p) => isStandardOwnedBy(p.program.state, pubkey32))
    .sort((a, b) => (a.program.state.amount < b.program.state.amount ? 1 : -1));
  const total = owned.reduce((s, p) => s + p.program.state.amount, 0n);
  if (total < amount) {
    throw new Kcc20StandardBuildError(
      "insufficient-balance",
      "Not enough spendable balance of this token",
    );
  }
  const picked: P[] = [];
  let sum = 0n;
  for (const p of owned) {
    if (sum >= amount) break;
    picked.push(p);
    sum += p.program.state.amount;
  }
  if (picked.length > MAX_TOKEN_INPUTS) {
    throw new Kcc20StandardBuildError(
      "fragmented",
      `Balance split across more than ${MAX_TOKEN_INPUTS} cells`,
    );
  }
  return picked;
}

export type StandardFamily = {
  spend: spend.CovenantSpend;
  leaderIndex: number;
  consumed: KCC20State[];
  nextStates: KCC20State[];
  successors: Uint8Array[];
  // One per token input, in input order.
  seats: Seat[];
};

/** Pure planning: next states, successor programs, placeholder seats, bound outputs. */
export function planStandardTransfer({
  covenantId,
  pieces,
  pubkey32,
  recipientKey,
  amount,
}: {
  covenantId: string;
  pieces: StandardSpendPiece[];
  pubkey32: Uint8Array;
  recipientKey: Uint8Array;
  amount: bigint;
}): StandardFamily {
  if (amount <= 0n) {
    throw new Kcc20StandardBuildError("invalid-amount", "Amount must be positive");
  }
  const parsed = pieces.map((piece) => ({ piece, program: splitProgram(piece.redeem) }));
  if (pieces.some((p) => !supportsStandardTransfer(p.redeem))) {
    throw new Kcc20StandardBuildError(
      "unsupported-template",
      "a token cell is not on a program template this wallet can spend",
    );
  }
  const picked = selectStandardPieces(parsed, pubkey32, amount);
  const leader = picked[0].program;
  for (const p of picked) {
    if (
      !bytesEqual(p.program.prefix, leader.prefix) ||
      !bytesEqual(p.program.suffix, leader.suffix)
    ) {
      throw new Kcc20StandardBuildError(
        "mixed-template",
        "token cells do not share one program template",
      );
    }
  }

  const consumed = picked.map((p) => p.program.state);
  const total = consumed.reduce((s, c) => s + c.amount, 0n);
  const ext = leader.state.extensionCommitment;
  const nextStates: KCC20State[] = [
    {
      amount,
      owner: recipientKey,
      ownerScheme: OWNER_SCHEME.P2PK_SCHNORR,
      borrowScheme: BORROW_SCHEME.DISABLED,
      borrowGuard: new Uint8Array(32),
      extensionCommitment: ext,
    },
  ];
  // Change keeps the leader's owner and borrow policy; an exact spend emits no change state.
  if (total > amount) nextStates.push({ ...leader.state, amount: total - amount });

  const leaderWitness = ownerWitnessPlaceholder(leader.state, pubkey32, true);
  assertFamilyRules(consumed, nextStates, leaderWitness);
  if (nextStates.length > MAX_TOKEN_OUTPUTS) {
    throw new Kcc20StandardBuildError("rule-violation", "too many token outputs");
  }

  const programs = picked.map((p) => p.piece.redeem);
  const seats = picked.map((p, i) =>
    i === LEADER_INDEX
      ? encodeLeaderSeat(i, nextStates, leaderWitness, programs[i])
      : encodeDelegatorSeat(
          i,
          ownerWitnessPlaceholder(p.program.state, pubkey32, false),
          programs[i],
        ),
  );
  // Every continuation inherits the leader's template; the leader validates the whole family.
  const successors = nextStates.map((s) => successorProgram(programs[LEADER_INDEX], s));

  return {
    leaderIndex: LEADER_INDEX,
    consumed,
    nextStates,
    successors,
    seats,
    spend: {
      kind: "transfer",
      inputs: picked.map((p, i) => ({
        transactionId: p.piece.outpoint.transactionId,
        index: p.piece.outpoint.index,
        value: p.piece.value,
        scriptPublicKey: payToScriptHashScript(programs[i]),
        signatureScript: bytesToHex(seats[i].script),
        redeem: programs[i],
        role: "transfer",
        computeBudget: SEAT_COMPUTE_BUDGET,
      })),
      // Each continuation is a fresh covenant output, so it carries the dust floor, not the input's
      // value; any KAS a cell carried above the floor flows into the wallet's change.
      outputs: successors.map((R) => ({
        value: spend.COVENANT_DUST,
        scriptPublicKey: payToScriptHashScript(R),
        role: "transfer",
        binding: { covid: covenantId, authorizingInput: LEADER_INDEX },
      })),
      economics: { amount },
    },
  };
}

/** WASM transaction → sdk-tx's `Tx`, so its SIGHASH_ALL digest can be reused as-is. */
export function toSdkTx(tx: Transaction): Tx {
  const j = JSON.parse(tx.serializeToSafeJSON());
  // Safe JSON writes a script public key as `<version:2><script>`.
  const spk = (s: string) => ({
    scriptVersion: parseInt(s.slice(0, 4), 16),
    scriptPublicKey: s.slice(4),
  });
  return {
    version: j.version,
    lockTime: BigInt(j.lockTime),
    subnetworkId: j.subnetworkId,
    gas: BigInt(j.gas),
    payload: j.payload ?? "",
    inputs: j.inputs.map((i: any) => ({
      previousOutpoint: { transactionId: i.transactionId, index: i.index },
      signatureScript: i.signatureScript,
      sequence: BigInt(i.sequence),
      computeBudget: i.computeBudget,
      utxo: {
        amount: BigInt(i.utxo.amount),
        ...spk(i.utxo.scriptPublicKey),
        blockDaaScore: BigInt(i.utxo.blockDaaScore),
        isCoinbase: i.utxo.isCoinbase,
        covenantId: i.utxo.covenantId ?? undefined,
      },
    })),
    outputs: j.outputs.map((o: any) => ({
      value: BigInt(o.value),
      ...spk(o.scriptPublicKey),
      covenant: o.covenant ?? undefined,
    })),
  };
}

export function standardSighash(tx: Transaction, inputIndex: number) {
  return schnorrSighash(toSdkTx(tx), inputIndex);
}

/** Returns the 65-byte signature (64-byte BIP-340 Schnorr + sighash type) over `sighash`. */
export type StandardSign = (
  inputIndex: number,
  sighash: Uint8Array,
) => Uint8Array | Promise<Uint8Array>;

/** Sign every token seat in place; each signature is verified before it is written. */
export async function signStandardSeats(
  tx: Transaction,
  seats: Seat[],
  pubkey32: Uint8Array,
  sign: StandardSign,
) {
  // Signature scripts are outside the digest, so every seat signs the same funded transaction.
  const patched: { inputIndex: number; hex: string }[] = [];
  for (const s of seats) {
    const sighash = standardSighash(tx, s.inputIndex);
    const sig = await sign(s.inputIndex, sighash);
    if (
      sig.length !== SIG_LEN ||
      sig[SIG_LEN - 1] !== SIGHASH_ALL ||
      !schnorr.verify(sig.subarray(0, 64), sighash, pubkey32)
    ) {
      throw new Kcc20StandardBuildError(
        "bad-signature",
        `seat ${s.inputIndex} signature does not verify under SIGHASH_ALL`,
      );
    }
    patched.push({ inputIndex: s.inputIndex, hex: bytesToHex(patchSeat(s, sig)) });
  }
  const inputs = tx.inputs;
  for (const { inputIndex, hex } of patched) inputs[inputIndex].signatureScript = hex;
  tx.inputs = inputs;
  return tx;
}

export type BuiltStandardTransfer = BuiltKcc20Transfer & { family: StandardFamily };

/** Pure half: plan, fund through the legacy fee path, leave seats as placeholders. */
export function assembleStandardTransfer({
  covenantId,
  pieces,
  pubkey32,
  recipient,
  amount,
  funding,
  address,
  feeRate,
}: {
  covenantId: string;
  pieces: StandardSpendPiece[];
  pubkey32: Uint8Array;
  recipient: string;
  amount: bigint;
  funding: Parameters<typeof fundCovenantSpend>[0]["funding"];
  address: string;
  feeRate?: number;
}): BuiltStandardTransfer {
  const family = planStandardTransfer({
    covenantId,
    pieces,
    pubkey32,
    recipientKey: recipientPubkey(recipient),
    amount,
  });
  const funded = fundCovenantSpend({
    spend: family.spend,
    funding,
    address,
    feeRate,
    fundingComputeBudget: FUNDING_COMPUTE_BUDGET,
  });
  // The leader rule only holds while no funding input sits before a token cell.
  const tokenInputs = family.seats.length;
  if (funded.fundingInputIndexes.some((i) => i < tokenInputs)) {
    throw new Kcc20StandardBuildError(
      "layout",
      "a funding input precedes a token cell",
    );
  }
  const sum = (xs: { value: bigint }[]) => xs.reduce((s, x) => s + x.value, 0n);
  return {
    ...funded,
    amount,
    kasDebit: funded.fee + sum(family.spend.outputs) - sum(family.spend.inputs),
    family,
  };
}

/**
 * Token seats signed, funding inputs left for `signKcc20Transfer` (the legacy funding signer).
 * Nothing here broadcasts.
 */
export async function buildStandardTransfer({
  rpc,
  address,
  pubkey32,
  tokenId,
  pieces,
  recipient,
  amount,
  feeRate,
  sign,
}: {
  rpc: Pick<RpcClient, "getUtxosByAddresses">;
  address: string;
  pubkey32: Uint8Array;
  tokenId: string;
  pieces: StandardSpendPiece[];
  recipient: string;
  amount: bigint;
  feeRate?: number;
  sign: StandardSign;
}): Promise<BuiltStandardTransfer> {
  const { entries } = await rpc.getUtxosByAddresses([address]);
  const built = assembleStandardTransfer({
    covenantId: tokenId,
    pieces,
    pubkey32,
    recipient,
    amount,
    funding: entries,
    address,
    feeRate,
  });
  await signStandardSeats(built.transaction, built.family.seats, pubkey32, sign);
  return built;
}
