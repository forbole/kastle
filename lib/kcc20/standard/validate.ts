import { concatBytes } from "@noble/hashes/utils";
import { bytesEqual, decodeIntState, hash, INT_MAX } from "./primitives";
import {
  BORROW_SCHEME,
  KCC20State,
  MAX_BORROW_SCHEME,
  MAX_OWNER_SCHEME,
  OWNER_SCHEME,
} from "./state";

// Pure mirrors of the KCC-20 §3 transfer and §5 borrowed-receive rules. They exist to pin the
// conformance vectors and to gate future write support; no transaction builder calls them.
// Signature checks are out of scope: every rule here is one a signature cannot change.

export const MAX_TOKEN_INPUTS = 3;
export const MAX_TOKEN_OUTPUTS = 3;

export const WITNESS_PATH = { TRANSFER: 0x00, BORROW: 0x01 } as const;

export type Verdict<Code extends string> =
  | { ok: true }
  | { ok: false; code: Code; reason: string };

/** Bytes after the path byte that each owner scheme's authorization takes (KCC-2). */
export function ownerAuthLength(ownerScheme: number): number | undefined {
  switch (ownerScheme) {
    case OWNER_SCHEME.P2PK_SCHNORR:
      return 65;
    case OWNER_SCHEME.P2PKH_SCHNORR:
      return 32 + 65;
    case OWNER_SCHEME.P2PKH_ECDSA:
      return 33 + 65;
    case OWNER_SCHEME.P2SH:
      return 1;
    case OWNER_SCHEME.COVENANT_ID:
      return 0;
    default:
      return undefined;
  }
}

/** Bytes after the path byte that each borrow scheme's witness takes; undefined when borrowing is impossible. */
export function borrowWitnessLength(borrowScheme: number): number | undefined {
  switch (borrowScheme) {
    case BORROW_SCHEME.AMOUNT_THRESHOLD:
      return 0;
    case BORROW_SCHEME.SCHNORR_SIGNATURE:
      return 65;
    case BORROW_SCHEME.HASH_CHAIN:
      return 32 + 32 + 65;
    default:
      return undefined;
  }
}

export type TransferRejection =
  | "empty-family"
  | "over-max-token-inputs"
  | "over-max-token-outputs"
  | "invalid-witness-path-byte"
  | "borrow-path"
  | "invalid-owner-auth"
  | "negative-amount"
  | "amount-out-of-range"
  | "unsupported-owner-scheme"
  | "unsupported-borrow-scheme"
  | "malformed-field"
  | "extension-commitment-not-preserved"
  | "amount-not-preserved";

/**
 * A normal (path 0x00) leader transfer: `inputs[0]` is the leader, the rest are delegates of the
 * same covenant id. A path 0x01 witness is a borrowed receive and belongs to `validateBorrowedReceive`.
 */
export function validateStandardTransfer(t: {
  inputs: KCC20State[];
  nextStates: KCC20State[];
  witness: Uint8Array;
  maxTokenInputs?: number;
  maxTokenOutputs?: number;
}): Verdict<TransferRejection> {
  const reject = (code: TransferRejection, reason: string) =>
    ({ ok: false, code, reason }) as const;
  const maxIns = t.maxTokenInputs ?? MAX_TOKEN_INPUTS;
  const maxOuts = t.maxTokenOutputs ?? MAX_TOKEN_OUTPUTS;
  const leader = t.inputs[0];
  if (!leader || t.nextStates.length === 0) {
    return reject(
      "empty-family",
      "a transfer needs a leader input and at least one next state",
    );
  }
  if (t.inputs.length > maxIns) {
    return reject(
      "over-max-token-inputs",
      `${t.inputs.length} token inputs exceed max_token_inputs ${maxIns}`,
    );
  }
  if (t.nextStates.length > maxOuts) {
    return reject(
      "over-max-token-outputs",
      `${t.nextStates.length} token outputs exceed max_token_outputs ${maxOuts}`,
    );
  }
  const path = t.witness[0];
  if (path === WITNESS_PATH.BORROW) {
    return reject("borrow-path", "witness path 0x01 is a borrowed receive");
  }
  if (path !== WITNESS_PATH.TRANSFER) {
    return reject(
      "invalid-witness-path-byte",
      `witness path byte ${path} is reserved`,
    );
  }
  if (t.witness.length - 1 !== ownerAuthLength(leader.ownerScheme)) {
    return reject(
      "invalid-owner-auth",
      "owner authorization length does not match the leader's owner_scheme",
    );
  }
  for (const s of [...t.inputs, ...t.nextStates]) {
    if (s.amount < 0n)
      return reject("negative-amount", "a state amount is negative");
    if (s.amount > INT_MAX)
      return reject("amount-out-of-range", "a state amount exceeds 2^63-1");
    if (s.ownerScheme > MAX_OWNER_SCHEME) {
      return reject(
        "unsupported-owner-scheme",
        `owner_scheme ${s.ownerScheme} is not supported`,
      );
    }
    if (s.borrowScheme > MAX_BORROW_SCHEME) {
      return reject(
        "unsupported-borrow-scheme",
        `borrow_scheme ${s.borrowScheme} is not supported`,
      );
    }
    if (
      s.owner.length !== 32 ||
      s.borrowGuard.length !== 32 ||
      s.extensionCommitment.length !== 32
    ) {
      return reject(
        "malformed-field",
        "a 32-byte state field has the wrong length",
      );
    }
  }
  for (const s of [...t.inputs, ...t.nextStates]) {
    if (!bytesEqual(s.extensionCommitment, leader.extensionCommitment)) {
      return reject(
        "extension-commitment-not-preserved",
        "an extension_commitment differs from the leader's",
      );
    }
  }
  const sum = (states: KCC20State[]) =>
    states.reduce((acc, s) => acc + s.amount, 0n);
  const totalIn = sum(t.inputs);
  const totalOut = sum(t.nextStates);
  if (totalIn !== totalOut) {
    return reject(
      "amount-not-preserved",
      `total successor amount ${totalOut} does not equal total input amount ${totalIn}`,
    );
  }
  return { ok: true };
}

export type BorrowRejection =
  | "borrow-disabled"
  | "unassigned-borrow-scheme"
  | "invalid-witness-path-byte"
  | "invalid-borrow-witness"
  | "borrow-scheme-changed"
  | "owner-changed"
  | "owner-scheme-changed"
  | "extension-commitment-changed"
  | "kas-value-reduced"
  | "amount-decreased"
  | "threshold-not-exceeded"
  | "hash-chain-link-mismatch"
  | "borrow-guard-mismatch";

/** Effective amount-threshold: the signed first 8 bytes of the guard, floored at zero. */
export function effectiveThreshold(borrowGuard: Uint8Array): bigint {
  const decoded = decodeIntState(borrowGuard.subarray(0, 8));
  return decoded > 0n ? decoded : 0n;
}

/** A borrowed receive (path 0x01) on the leader, whose successor is `next_states[0]`. */
export function validateBorrowedReceive(b: {
  leader: KCC20State;
  successor: KCC20State;
  witness: Uint8Array;
  leaderKasValue?: bigint;
  successorKasValue?: bigint;
}): Verdict<BorrowRejection> {
  const reject = (code: BorrowRejection, reason: string) =>
    ({ ok: false, code, reason }) as const;
  const { leader, successor, witness } = b;
  const scheme = leader.borrowScheme;
  if (scheme === BORROW_SCHEME.DISABLED)
    return reject("borrow-disabled", "borrow_scheme is disabled/v1");
  const borrowLen = borrowWitnessLength(scheme);
  if (borrowLen === undefined) {
    return reject(
      "unassigned-borrow-scheme",
      `borrow_scheme ${scheme} is unassigned`,
    );
  }
  if (witness[0] !== WITNESS_PATH.BORROW) {
    return reject(
      "invalid-witness-path-byte",
      "a borrowed receive needs witness path 0x01",
    );
  }
  const borrowWitness = witness.subarray(1);
  if (borrowWitness.length !== borrowLen) {
    return reject(
      "invalid-borrow-witness",
      `borrow witness must be ${borrowLen} bytes`,
    );
  }
  if (successor.borrowScheme !== scheme) {
    return reject(
      "borrow-scheme-changed",
      "borrowed successor does not preserve borrow_scheme",
    );
  }
  if (!bytesEqual(successor.owner, leader.owner)) {
    return reject(
      "owner-changed",
      "borrowed successor does not preserve owner",
    );
  }
  if (successor.ownerScheme !== leader.ownerScheme) {
    return reject(
      "owner-scheme-changed",
      "borrowed successor does not preserve owner_scheme",
    );
  }
  if (!bytesEqual(successor.extensionCommitment, leader.extensionCommitment)) {
    return reject(
      "extension-commitment-changed",
      "borrowed successor does not preserve extension_commitment",
    );
  }
  if (
    b.leaderKasValue !== undefined &&
    b.successorKasValue !== undefined &&
    b.successorKasValue < b.leaderKasValue
  ) {
    return reject(
      "kas-value-reduced",
      "borrowed successor output carries less KAS than the borrowed input",
    );
  }
  if (successor.amount < leader.amount) {
    return reject(
      "amount-decreased",
      "borrowed successor amount is smaller than the leader's amount",
    );
  }
  const threshold =
    scheme === BORROW_SCHEME.AMOUNT_THRESHOLD
      ? effectiveThreshold(leader.borrowGuard)
      : 0n;
  if (successor.amount - leader.amount <= threshold) {
    return reject(
      "threshold-not-exceeded",
      `amount increase does not strictly exceed the threshold ${threshold}`,
    );
  }
  let expectedGuard = leader.borrowGuard;
  if (scheme === BORROW_SCHEME.HASH_CHAIN) {
    const preimage = borrowWitness.subarray(0, 32);
    const oneTimePubkey = borrowWitness.subarray(32, 64);
    if (
      !bytesEqual(
        hash(concatBytes(preimage, oneTimePubkey)),
        leader.borrowGuard,
      )
    ) {
      return reject(
        "hash-chain-link-mismatch",
        "revealed link does not hash to the leader's borrow_guard",
      );
    }
    expectedGuard = preimage;
  }
  if (!bytesEqual(successor.borrowGuard, expectedGuard)) {
    return reject(
      "borrow-guard-mismatch",
      "borrowed successor does not carry the expected borrow_guard",
    );
  }
  return { ok: true };
}
