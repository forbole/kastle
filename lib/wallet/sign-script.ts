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

// Sighash types split on one axis: how much of the output set the signature
// commits to.
//   All / AllAnyOneCanPay        -> every output committed        (safe)
//   Single / SingleAnyOneCanPay  -> only the same-index output     (partial)
//   None / NoneAnyOneCanPay      -> no outputs committed at all    (unsafe)
// With None*, the amount and destination the confirm screen showed are not
// bound by the signature and can be rewritten after approval, so they are
// refused outright.
// TODO: allow per-request opt-in from an advanced setting instead of a
// hardcoded constant, once that setting exists.
const ALLOW_UNSAFE_OUTPUT_SIGHASH = false;

const UNSAFE_OUTPUT_SIGN_TYPES = ["None", "NoneAnyOneCanPay"] as const;
const PARTIAL_OUTPUT_SIGN_TYPES = ["Single", "SingleAnyOneCanPay"] as const;

// Chokepoint for the None* refusal: called from normalizeScriptOptions (fails
// the whole request early, before any mutation) AND from
// signTxInputWithScriptOption itself, so a future caller that skips
// normalization cannot silently reintroduce unsafe signing.
function assertSafeOutputSighash(signType: string, inputIndex: number): void {
  if (
    !ALLOW_UNSAFE_OUTPUT_SIGHASH &&
    (UNSAFE_OUTPUT_SIGN_TYPES as readonly string[]).includes(signType)
  ) {
    throw new Error(
      `signTx: signType "${signType}" commits no outputs, so every output could be rewritten after signing; refusing to sign input ${inputIndex}`,
    );
  }
}

/**
 * True when any option signs with a sighash type that commits only part of the
 * outputs, so the rest can still change after the user approves. Non-throwing:
 * safe to call from render paths that also display invalid requests.
 */
export function hasPartialOutputCommitment(
  scripts?: (RawScriptOption | null | undefined)[],
): boolean {
  return (scripts ?? []).some((option) =>
    (PARTIAL_OUTPUT_SIGN_TYPES as readonly string[]).includes(
      option?.signType ?? "All",
    ),
  );
}

/**
 * True when the request carries at least one actual script option. The dApp
 * payload schema defaults `scripts` to [], so callers must not use a bare
 * existence check — an empty (or all-null sparse) array means "no scripts".
 * Non-throwing: safe to call from render paths.
 */
export function hasScriptOptions(
  scripts?: (RawScriptOption | null | undefined)[],
): boolean {
  return (scripts ?? []).some((option) => option != null);
}

// The all-zero "native" subnetwork — the only value the Ledger app can sign
// over (and the one its sighash hardcodes). Same literal the Ledger account
// rebuilds broadcast transactions with (lib/wallet/account/ledger-account.ts).
const NATIVE_SUBNETWORK_ID = "00".repeat(20);

// Payload values that mean "no payload". The WASM getter returns plain hex
// ("" when empty), but be tolerant of undefined/null and a bare "0x" prefix.
function isEmptyPayload(payload: unknown): boolean {
  return payload == null || payload === "" || payload === "0x";
}

/**
 * KAS-002 defect A1 — fields the Ledger device provably does not sign over.
 *
 * hw-app-kaspa v1.2.1 serialises each input as a fixed 46-byte frame
 * (value / prevTxId / outpointIndex / addressType / addressIndex), so
 * `sequence`, `lockTime`, `gas`, `subnetworkId` and `payload` never cross the
 * APDU wire, and the Ledger app's sighash hardcodes them all to zero (and
 * `version`, and forces SIGHASH_ALL). A transaction carrying any non-default
 * value still produces a VALID signature — over the zeroed rewrite, not over
 * what the user inspected — so the user approves one transaction and a
 * different one broadcasts. Refuse before any device interaction.
 * Unblock: KAS-002 A2 (Ledger app support for these fields).
 *
 * Field types and zero values per wasm/core/kaspa.d.ts (class Transaction):
 * version: number, lockTime: bigint, gas: bigint, subnetworkId: string,
 * payload: string, inputs[].sequence: bigint.
 *
 * Fail closed: malformed or ambiguous values count as unsignable.
 * Non-throwing: safe to call from render paths.
 */
export function hasUnsignableFields(tx: Transaction): boolean {
  try {
    if (tx.version !== 0) return true;
    if (tx.lockTime !== 0n) return true;
    if (tx.gas !== 0n) return true;
    if (!isEmptyPayload(tx.payload)) return true;
    if (tx.subnetworkId !== NATIVE_SUBNETWORK_ID) return true;
    // read tx.inputs once — each access crosses the WASM boundary
    const inputs = tx.inputs ?? [];
    for (const input of inputs) {
      if (input?.sequence !== 0n) return true;
    }
    return false;
  } catch {
    // a transaction whose fields cannot even be read cannot be proven safe
    return true;
  }
}

export function normalizeScriptOptions(
  scripts?: (RawScriptOption | null | undefined)[],
): ScriptOption[] {
  return (scripts ?? [])
    .filter((option): option is RawScriptOption => option != null)
    .map((option) => {
      const { inputIndex } = option;
      if (
        typeof inputIndex !== "number" ||
        !Number.isInteger(inputIndex) ||
        inputIndex < 0
      ) {
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

      const signType = option.signType ?? "All";
      assertSafeOutputSighash(signType, inputIndex);

      return { inputIndex, scriptHex, signType };
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
  assertSafeOutputSighash(option.signType ?? "All", option.inputIndex);

  // each tx.inputs access crosses the WASM boundary; read it once
  const inputs = tx.inputs;
  if (option.inputIndex >= inputs.length) {
    throw new Error(
      `signTx: sign option references non-existent input ${option.inputIndex}`,
    );
  }

  // never mutate an input that already carries a signatureScript
  if (inputs[option.inputIndex].signatureScript) {
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
  inputs[option.inputIndex].signatureScript = option.scriptHex
    ? signature + pushDataHex(option.scriptHex)
    : signature;
}

// NOTE: This does not support signing with multiple keys
export async function signTxWithScriptOptions(
  tx: Transaction,
  scripts: RawScriptOption[] | undefined,
  privateKeyString: string,
): Promise<Transaction> {
  const options = normalizeScriptOptions(scripts);

  // validate every option before the first mutation so a bad one can't
  // leave the transaction partially signed
  const inputs = tx.inputs;
  const seen = new Set<number>();
  for (const option of options) {
    if (option.inputIndex >= inputs.length) {
      throw new Error(
        `signTx: sign option references non-existent input ${option.inputIndex}`,
      );
    }
    if (inputs[option.inputIndex].signatureScript) {
      throw new Error(
        `signTx: input ${option.inputIndex} already carries a signatureScript`,
      );
    }
    if (seen.has(option.inputIndex)) {
      throw new Error(
        `signTx: duplicate sign option for input ${option.inputIndex}`,
      );
    }
    seen.add(option.inputIndex);
  }

  for (const option of options) {
    signTxInputWithScriptOption(tx, option, privateKeyString);
  }

  const isFullySigned = tx.inputs.every((input) => !!input.signatureScript);
  if (isFullySigned) {
    return tx;
  }

  return signTransaction(tx, [privateKeyString], false);
}
