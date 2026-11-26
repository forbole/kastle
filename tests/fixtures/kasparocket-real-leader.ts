import { hexToBytes } from "viem";
import real from "./kasparocket-plan.trade-buy-FOUR.real.json" with { type: "json" };

// No node:fs: the swap-sheet render harness bundles this (through the
// synthetic buy) for the browser.

/**
 * The token's program the real FOUR buy spends: the last push of its leader
 * input (`summary.inputs.kcc20Leader`, input 1), one OP_PUSHDATA2 of 11458
 * bytes.
 */
export const REAL_LEADER_PROGRAM: Uint8Array = (() => {
  const at = real.plan.summary.inputs.kcc20Leader;
  const sig = hexToBytes(
    `0x${real.plan.transactions[0].tx.inputs[at].signatureScript}`,
  );
  const len = 11458;
  const start = sig.length - len;
  if (
    sig[start - 3] !== 0x4d ||
    (sig[start - 2] | (sig[start - 1] << 8)) !== len
  )
    throw new Error("real leader input no longer ends in its program push");
  return sig.slice(start);
})();
