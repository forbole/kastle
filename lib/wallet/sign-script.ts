import {
  createInputSignature,
  PrivateKey,
  signTransaction,
  Transaction,
} from "@/wasm/core/kaspa";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { toSignType } from "@/lib/kaspa.ts";

// dApps send the documented `scriptHex`, but some send `script` instead —
// accept both. Arrays may also be sparse (holes / null entries).
export type RawScriptOption = Partial<ScriptOption> & { script?: string };

const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

export function normalizeScriptOptions(
  scripts?: (RawScriptOption | null | undefined)[],
): ScriptOption[] {
  return (scripts ?? [])
    .filter((option): option is RawScriptOption => option != null)
    .map((option) => {
      const { inputIndex } = option;
      if (typeof inputIndex !== "number" || !Number.isInteger(inputIndex) || inputIndex < 0) {
        throw new Error(
          `signTx: sign option has invalid inputIndex ${JSON.stringify(inputIndex)}`,
        );
      }

      const scriptHex = option.scriptHex ?? option.script;
      if (
        scriptHex !== undefined &&
        (typeof scriptHex !== "string" || !HEX_RE.test(scriptHex))
      ) {
        throw new Error(`signTx: invalid scriptHex for input ${inputIndex}`);
      }

      return { inputIndex, scriptHex, signType: option.signType ?? "All" };
    });
}

/**
 * Canonical script data push (OpData1-75 / OpPushData1/2/4).
 * The vendored ScriptBuilder caps pushed elements at 520 bytes, which is
 * below what v1 covenant redeem scripts need, so encode the push locally.
 */
export function pushDataHex(dataHex: string): string {
  const byteLen = dataHex.length / 2;
  const u8 = (n: number) => n.toString(16).padStart(2, "0");

  if (byteLen === 0) return "00"; // Op0
  if (byteLen <= 75) return u8(byteLen) + dataHex;
  if (byteLen <= 0xff) return "4c" + u8(byteLen) + dataHex; // OpPushData1
  if (byteLen <= 0xffff)
    return "4d" + u8(byteLen & 0xff) + u8(byteLen >> 8) + dataHex; // OpPushData2
  return (
    "4e" +
    u8(byteLen & 0xff) +
    u8((byteLen >> 8) & 0xff) +
    u8((byteLen >> 16) & 0xff) +
    u8(byteLen >>> 24) +
    dataHex
  ); // OpPushData4
}

export function signTxInputWithScriptOption(
  tx: Transaction,
  option: ScriptOption,
  privateKeyString: string,
) {
  if (option.inputIndex >= tx.inputs.length) {
    throw new Error(
      `signTx: sign option references non-existent input ${option.inputIndex}`,
    );
  }

  // never mutate an input that already carries a signatureScript
  if (tx.inputs[option.inputIndex].signatureScript) {
    throw new Error(
      `signTx: input ${option.inputIndex} already carries a signatureScript`,
    );
  }

  const signature = createInputSignature(
    tx,
    option.inputIndex,
    new PrivateKey(privateKeyString),
    toSignType(option.signType ?? "All"),
  );

  // `signature` is already a push-encoded script element; for P2SH append
  // the canonical push of the supplied redeem script.
  tx.inputs[option.inputIndex].signatureScript = option.scriptHex
    ? signature + pushDataHex(option.scriptHex)
    : signature;
}

// NOTE: This does not support signing with multiple keys
export async function signTxWithScriptOptions(
  tx: Transaction,
  scripts: RawScriptOption[] | undefined,
  privateKeyString: string,
): Promise<Transaction> {
  for (const option of normalizeScriptOptions(scripts)) {
    signTxInputWithScriptOption(tx, option, privateKeyString);
  }

  const isFullySigned = tx.inputs.every((input) => !!input.signatureScript);
  if (isFullySigned) {
    return tx;
  }

  return signTransaction(tx, [privateKeyString], false);
}
