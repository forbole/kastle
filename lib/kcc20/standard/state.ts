import { concatBytes } from "@noble/hashes/utils";
import {
  decodeIntState,
  dispatchTag,
  encodeIntState,
  INT_MAX,
  isNegativeIntState,
  pushExplicit,
  pushMinimal,
} from "./primitives";

// The KCC-20 standard `KCC20State` record. Not the KRON legacy 46-byte state: the two never mix.

export type KCC20State = {
  amount: bigint;
  owner: Uint8Array;
  ownerScheme: number;
  borrowScheme: number;
  borrowGuard: Uint8Array;
  extensionCommitment: Uint8Array;
};

export const OWNER_SCHEME = {
  P2PK_SCHNORR: 0x00,
  P2PKH_SCHNORR: 0x01,
  P2PKH_ECDSA: 0x02,
  P2SH: 0x03,
  COVENANT_ID: 0x04,
} as const;

export const BORROW_SCHEME = {
  DISABLED: 0x00,
  AMOUNT_THRESHOLD: 0x01,
  SCHNORR_SIGNATURE: 0x02,
  HASH_CHAIN: 0x03,
} as const;

export const MAX_OWNER_SCHEME = OWNER_SCHEME.COVENANT_ID;
export const MAX_BORROW_SCHEME = BORROW_SCHEME.HASH_CHAIN;

export const STATE_RECORD_TYPE = "{int,byte[32],byte,byte,byte[32],byte[32]}";
export const TRANSFER_SIGNATURE = `transfer(${STATE_RECORD_TYPE}[],byte[])`;
export const TRANSFER_DELEGATOR_SIGNATURE = "transfer_delegator(byte[])";
export const TRANSFER_TAG = dispatchTag(TRANSFER_SIGNATURE);
export const TRANSFER_DELEGATOR_TAG = dispatchTag(TRANSFER_DELEGATOR_SIGNATURE);

/** Encoded `KCC20State`: 106 payload bytes plus six push opcodes. */
export const STATE_LEN = 112;

// Offsets of each PushExplicit opcode inside the encoded record, and the byte it must hold.
const FRAMING: [offset: number, opcode: number][] = [
  [0, 0x08],
  [9, 0x20],
  [42, 0x01],
  [44, 0x01],
  [46, 0x20],
  [79, 0x20],
];

export class Kcc20StateError extends Error {}

function assertValidState(state: KCC20State) {
  if (state.amount < 0n) throw new Kcc20StateError("amount is negative");
  if (state.amount > INT_MAX)
    throw new Kcc20StateError("amount exceeds 2^63-1");
  for (const [name, field] of [
    ["owner", state.owner],
    ["borrowGuard", state.borrowGuard],
    ["extensionCommitment", state.extensionCommitment],
  ] as const) {
    if (field.length !== 32)
      throw new Kcc20StateError(`${name} must be 32 bytes`);
  }
  if (
    !Number.isInteger(state.ownerScheme) ||
    state.ownerScheme < 0 ||
    state.ownerScheme > MAX_OWNER_SCHEME
  ) {
    throw new Kcc20StateError(`unsupported owner_scheme ${state.ownerScheme}`);
  }
  if (
    !Number.isInteger(state.borrowScheme) ||
    state.borrowScheme < 0 ||
    state.borrowScheme > MAX_BORROW_SCHEME
  ) {
    throw new Kcc20StateError(
      `unsupported borrow_scheme ${state.borrowScheme}`,
    );
  }
}

export function encodeState(state: KCC20State): Uint8Array {
  assertValidState(state);
  return concatBytes(
    pushExplicit(encodeIntState(state.amount)),
    pushExplicit(state.owner),
    pushExplicit(Uint8Array.of(state.ownerScheme)),
    pushExplicit(Uint8Array.of(state.borrowScheme)),
    pushExplicit(state.borrowGuard),
    pushExplicit(state.extensionCommitment),
  );
}

/** Strict decode of exactly one encoded record. Any framing, length, or value deviation throws. */
export function decodeState(bytes: Uint8Array): KCC20State {
  if (bytes.length !== STATE_LEN) {
    throw new Kcc20StateError(
      `state must be ${STATE_LEN} bytes, got ${bytes.length}`,
    );
  }
  for (const [offset, opcode] of FRAMING) {
    if (bytes[offset] !== opcode) {
      throw new Kcc20StateError(
        `unexpected push opcode at state offset ${offset}`,
      );
    }
  }
  const amountBytes = bytes.subarray(1, 9);
  // Sign bit set covers negative zero too: a balance is `amount >= 0` and has one encoding.
  if (isNegativeIntState(amountBytes))
    throw new Kcc20StateError("amount is negative");
  const state: KCC20State = {
    amount: decodeIntState(amountBytes),
    owner: bytes.slice(10, 42),
    ownerScheme: bytes[43],
    borrowScheme: bytes[45],
    borrowGuard: bytes.slice(47, 79),
    extensionCommitment: bytes.slice(80, 112),
  };
  assertValidState(state);
  return state;
}

/**
 * `transfer(next_states, witness)` sigScript arguments: the six field-grouped pushes, the witness push,
 * then the `transfer` dispatch tag. Pure and test-only; no transaction builder calls it.
 */
export function encodeTransferArgs(
  states: KCC20State[],
  witness: Uint8Array,
): Uint8Array {
  if (states.length === 0)
    throw new Kcc20StateError("transfer needs at least one next state");
  states.forEach(assertValidState);
  const column = (pick: (s: KCC20State) => Uint8Array) =>
    pushMinimal(concatBytes(...states.map(pick)));
  return concatBytes(
    column((s) => encodeIntState(s.amount)),
    column((s) => s.owner),
    column((s) => Uint8Array.of(s.ownerScheme)),
    column((s) => Uint8Array.of(s.borrowScheme)),
    column((s) => s.borrowGuard),
    column((s) => s.extensionCommitment),
    pushMinimal(witness),
    pushExplicit(TRANSFER_TAG),
  );
}
