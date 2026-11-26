import { concatBytes } from "@noble/hashes/utils";
import { classifyRedeem } from "../classify";
import { bytesEqual } from "./primitives";
import { encodeState, KCC20State, STATE_LEN } from "./state";

// A standard KCC-20 program's layout, and its successor for a new state. Pure:
// no WASM, no network, so the KaspaRocket signer can bind a cell to its state.
// Moved out of build-transfer.ts, which re-exports all of it.

// `6b` OP_TOALTSTACK + `20 <template_hash:32>`: the artifact's state_span starts at 1 and its
// first field is the template hash, so the KCC20State record spans R[34:146].
export const PROGRAM_PREFIX_LEN = 34;
const STATE_END = PROGRAM_PREFIX_LEN + STATE_LEN;

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
      c.family === "unknown"
        ? c.reason
        : `not a standard program (${c.family})`,
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
    !bytesEqual(
      successor.subarray(2, PROGRAM_PREFIX_LEN),
      R.subarray(2, PROGRAM_PREFIX_LEN),
    )
  ) {
    throw new Kcc20StandardBuildError(
      "layout",
      "successor program changed length or template hash",
    );
  }
  return successor;
}
