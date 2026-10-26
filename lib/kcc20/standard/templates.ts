import { bytesToHex } from "@noble/hashes/utils";
import { classifyRedeem } from "../classify";
import { hash } from "./primitives";
import { STATE_LEN } from "./state";

// The program templates this wallet can build a `transfer` for. An allowlist, not a shape rule:
// the real program carries an OP_RETURN in its suffix, so no opcode scan can tell ours apart.

/** The mainnet KCC-20 standard program (blake3 of R[146:] pins the code after the state). */
export const CANONICAL_TEMPLATE_HASH =
  "9703112ee6e3555107cd168858992b77d3b74f655205b2b463b1f9ec2ec73cf7";
export const CANONICAL_SUFFIX_LEN = 3885;
export const CANONICAL_SUFFIX_HASH =
  "7c67a1e0cbe3767d1cb5dfaa3b0010d6bd2d123c016fb617b6a19abafa6087df";

/** Whether `program` is the canonical standard template, so its cell can be spent here. */
export function supportsStandardTransfer(program: Uint8Array): boolean {
  const c = classifyRedeem(program);
  if (c.family !== "kcc20-standard") return false;
  if (c.templateHash !== CANONICAL_TEMPLATE_HASH) return false;
  const suffix = program.subarray(c.stateOffset + STATE_LEN);
  return (
    suffix.length === CANONICAL_SUFFIX_LEN &&
    bytesToHex(hash(suffix)) === CANONICAL_SUFFIX_HASH
  );
}
