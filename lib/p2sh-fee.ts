import type { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import {
  payToAddressScript,
  Transaction,
  TransactionOutput,
} from "@/wasm/core/kaspa";
import { calcRevealInputMass } from "@/lib/kaspaFee";

// P2SH scriptPublicKey: OP_BLAKE2B(aa) PUSH_32(20) <32B hash> OP_EQUAL(87) = 70 hex chars
export function isP2SHScript(script: string): boolean {
  return (
    script.length === 70 && script.startsWith("aa20") && script.endsWith("87")
  );
}

// Adjust fee upfront for P2SH redeem script overhead the external builder may have missed.
// P2SH sig script = sig(65B) + push prefix(2B) + redeem script(NB) vs plain sig(65B).
// Fee rate: 100 per mass gram.
export function applyP2SHFeeAdjustment(
  tx: Transaction,
  scripts: ScriptOption[],
  userAddress: string,
): boolean {
  const extraFee = scripts.reduce((sum, s) => {
    if (!s.scriptHex) return sum;
    const input = tx.inputs[s.inputIndex];
    if (!input) return sum;
    const script = input.utxo?.scriptPublicKey.script ?? "";
    if (!isP2SHScript(script)) return sum;
    return sum + calcRevealInputMass(s.scriptHex) * 100n;
  }, 0n);

  if (extraFee === 0n) return false;

  const expectedScript = payToAddressScript(userAddress).script;
  const outputs = tx.outputs;
  const changeIdx = outputs.findIndex(
    (o) => o.scriptPublicKey.script === expectedScript,
  );

  if (changeIdx === -1 || outputs[changeIdx].value <= extraFee) return false;

  tx.outputs = outputs.map((o, i) =>
    i === changeIdx
      ? new TransactionOutput(o.value - extraFee, o.scriptPublicKey)
      : o,
  );
  tx.finalize();
  return true;
}
