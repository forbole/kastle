import { bytesToHex } from "@noble/hashes/utils";
import { classifyRedeem } from "../classify";
import { hash } from "./primitives";
import { STATE_LEN } from "./state";

// The program templates this wallet can build a `transfer` for. An allowlist, not a shape rule:
// the real programs carry an OP_RETURN in their suffix, so no opcode scan tells ours apart.
//
// Both entries were proven by a kascov preflight of a full spend signed by the owner's key:
// each returned `verdict: ready`. Add a new build the same way, never by pattern.

interface Template {
  /** Bytes after the 112-byte state. */
  suffixLen: number;
  /** blake3 of those bytes. */
  suffixHash: string;
}

export const STANDARD_TEMPLATES: Readonly<Record<string, Template>> = {
  // 4031-byte program, the first mainnet build.
  "9703112ee6e3555107cd168858992b77d3b74f655205b2b463b1f9ec2ec73cf7": {
    suffixLen: 3885,
    suffixHash:
      "7c67a1e0cbe3767d1cb5dfaa3b0010d6bd2d123c016fb617b6a19abafa6087df",
  },
  // 11458-byte program, the build most new tokens use.
  ff3ae732e3a2819bf9181f5aed6b1e9d0f7abea70a1dd655b8e777cbcbd2422b: {
    suffixLen: 11312,
    suffixHash:
      "4d692c5148a094b966542f9cbf5728eee4e28d70da54de12dffd6a8a95fe9807",
  },
};

/** Whether `program` is a standard template this wallet can spend from. */
export function supportsStandardTransfer(program: Uint8Array): boolean {
  const c = classifyRedeem(program);
  if (c.family !== "kcc20-standard") return false;
  const template = STANDARD_TEMPLATES[c.templateHash];
  if (!template) return false;
  const suffix = program.subarray(c.stateOffset + STATE_LEN);
  return (
    suffix.length === template.suffixLen &&
    bytesToHex(hash(suffix)) === template.suffixHash
  );
}
