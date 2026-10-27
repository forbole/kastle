import { bytesToHex, hexToBytes } from "viem";
import type { BuiltTx } from "@kassealhq/sdk";
import { Transaction } from "@/wasm/core/kaspa";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";

const SIG_LEN = 65;

/** Writes a 65-byte signature over the zero placeholder at `offset`. */
export function spliceAt(
  script: Uint8Array,
  offset: number,
  sig: Uint8Array,
): Uint8Array {
  if (sig.length !== SIG_LEN) throw new Error("signature must be 65 bytes");
  const at = script.subarray(offset, offset + SIG_LEN);
  if (at.length !== SIG_LEN || at.some((b) => b !== 0))
    throw new Error("no signature placeholder at signatureOffset");
  const out = script.slice();
  out.set(sig, offset);
  return out;
}

/**
 * Signs a Kasseal build with the wallet; returns signed SafeJSON for
 * `finalize`. Covenant (p2sh-*) slots get a raw SIGHASH_ALL digest signature
 * spliced at their offset, as KCC-20 seats do; p2pk funding goes through
 * signTx with explicit indexes so it never signs every owned input.
 */
export async function signKassealTx(
  wallet: IWallet,
  built: BuiltTx,
): Promise<string> {
  const tx = Transaction.deserializeFromSafeJSON(built.txJson);
  const patched: { index: number; hex: string }[] = [];
  for (const slot of built.inputsToSign) {
    if (slot.kind === "p2pk") continue;
    if (slot.signatureOffset === undefined)
      throw new Error(`input ${slot.index} has no signature offset`);
    const sig = await wallet.signInputDigest(tx, slot.index);
    const script = hexToBytes(`0x${tx.inputs[slot.index].signatureScript}`);
    patched.push({
      index: slot.index,
      hex: bytesToHex(spliceAt(script, slot.signatureOffset, sig)).slice(2),
    });
  }
  const inputs = tx.inputs;
  for (const { index, hex } of patched) inputs[index].signatureScript = hex;
  tx.inputs = inputs;

  const p2pk = built.inputsToSign.filter((slot) => slot.kind === "p2pk");
  const signed = p2pk.length
    ? await wallet.signTx(
        tx,
        p2pk.map((slot) => ({ inputIndex: slot.index, signType: "All" })),
      )
    : tx;
  return signed.serializeToSafeJSON();
}
