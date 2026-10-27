import { kcc20 } from "@kronsdk/kron-sdk";
import { bytesToHex } from "@noble/hashes/utils";
import { bytesEqual, hash } from "./standard/primitives";
import {
  decodeState,
  KCC20State,
  OWNER_SCHEME,
  STATE_LEN,
  TRANSFER_TAG,
} from "./standard/state";

// Decides which state family a redeem script carries. Standard first, then a hard veto on the
// Argent prefix shape, then the KRON legacy scanner unchanged. classifiedPieces is the only caller.

export type Classified =
  | {
      family: "kcc20-standard";
      templateHash: string;
      state: KCC20State;
      stateOffset: number;
    }
  | { family: "kron-legacy"; state: kcc20.Kcc20State }
  | { family: "unknown"; reason: string };

const OP_TOALTSTACK = 0x6b;
const OP_DATA_32 = 0x20;
// OP_TOALTSTACK, push32 template hash.
const STANDARD_STATE_OFFSET = 34;
const STANDARD_STATE_END = STANDARD_STATE_OFFSET + STATE_LEN;
// Absolute positions of the KCC20State push opcodes.
const STANDARD_FRAMING: [offset: number, opcode: number][] = [
  [34, 0x08],
  [43, 0x20],
  [76, 0x01],
  [78, 0x01],
  [80, 0x20],
  [113, 0x20],
];
const TRANSFER_TAG_PUSH = Uint8Array.of(TRANSFER_TAG.length, ...TRANSFER_TAG);

function hasArgentPrefixShape(R: Uint8Array) {
  return R[0] === OP_TOALTSTACK && R[1] === OP_DATA_32;
}

function contains(haystack: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function matchStandard(R: Uint8Array): Classified {
  if (!hasArgentPrefixShape(R))
    return { family: "unknown", reason: "no Argent prefix" };
  if (R.length < STANDARD_STATE_END) {
    return { family: "unknown", reason: "too short for a KCC20State" };
  }
  for (const [offset, opcode] of STANDARD_FRAMING) {
    if (R[offset] !== opcode) {
      return {
        family: "unknown",
        reason: `unexpected push opcode at offset ${offset}`,
      };
    }
  }
  let state: KCC20State;
  try {
    state = decodeState(R.subarray(STANDARD_STATE_OFFSET, STANDARD_STATE_END));
  } catch (e) {
    return {
      family: "unknown",
      reason: `invalid KCC20State: ${(e as Error).message}`,
    };
  }
  if (!contains(R.subarray(STANDARD_STATE_END), TRANSFER_TAG_PUSH)) {
    return {
      family: "unknown",
      reason: "no transfer dispatch tag after the state",
    };
  }
  return {
    family: "kcc20-standard",
    templateHash: bytesToHex(R.subarray(2, STANDARD_STATE_OFFSET)),
    state,
    stateOffset: STANDARD_STATE_OFFSET,
  };
}

export function classifyRedeem(R: Uint8Array): Classified {
  const standard = matchStandard(R);
  if (standard.family === "kcc20-standard") return standard;
  // A crafted standard script can embed the legacy 46-byte pattern; never let the scanner see one.
  if (hasArgentPrefixShape(R)) return standard;
  try {
    return { family: "kron-legacy", state: kcc20.decodeKcc20Redeem(R).state };
  } catch (e) {
    return { family: "unknown", reason: (e as Error).message };
  }
}

/** Whether a Schnorr hot wallet whose x-only pubkey is `walletPubkey32` controls a standard state. */
export function isStandardOwnedBy(
  state: KCC20State,
  walletPubkey32: Uint8Array,
) {
  if (walletPubkey32.length !== 32) return false;
  switch (state.ownerScheme) {
    case OWNER_SCHEME.P2PK_SCHNORR:
      return bytesEqual(state.owner, walletPubkey32);
    case OWNER_SCHEME.P2PKH_SCHNORR:
      return bytesEqual(state.owner, hash(walletPubkey32));
    default:
      return false;
  }
}
