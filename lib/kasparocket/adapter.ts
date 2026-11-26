import {
  schnorrSighash,
  type Tx,
  type TxInput,
  type TxOutput,
} from "@dotk/sdk-tx";
import {
  instructionsToSign,
  type PlannedTransaction,
  type TransactionPlan,
} from "@kasparocket/sdk";
import { bytesToHex } from "viem";
import { KASPAROCKET_MAX_INPUTS } from "./config";

/**
 * A KaspaRocket plan's transaction as @dotk/sdk-tx's Tx, read from the
 * transaction the SDK hands a signer (`PlannedTransaction.tx`, left unparsed
 * by the SDK). Strict: any field this reader does not know is refused, so a
 * digest is never computed over a transaction it half read.
 *
 * Two wire shapes are read. The rusty-kaspa safe-JSON one (outpoint flat on
 * the input, `scriptPublicKey` a hex string with its 2-byte version in
 * front), and the one `/pro-api/plan/trade` actually sends (checked against a
 * real buy, 2026-11-26), which differs in five places:
 *  - `input.previousOutpoint: { transactionId, index }` instead of the flat
 *    pair: read, the same checks as the flat form, exactly one form allowed;
 *  - `scriptPublicKey: { version, script }` on coins and outputs, the form
 *    @dotk/sdk-tx's own wasm adapters take: read, version and hex checked;
 *  - `utxo.outpoint`: the coin's outpoint repeated. Dropped once checked
 *    equal to the input's: a coin that names another outpoint refuses;
 *  - `utxo.covenantId`: the coin's KIP-20 covenant id, null on a plain coin.
 *    Checked (null or 32-byte hex) and carried as `UtxoEntry.covenantId`;
 *  - `storageMass`: the KIP-9 storage mass, a u64. Checked, then dropped:
 *    it is not in a v1 sighash and dotk's Tx has no field for it (the node
 *    recomputes it, as it does `mass`).
 * Anything outside those, in either shape, still refuses.
 */

export class KaspaRocketTxFormatError extends Error {
  constructor(message: string) {
    super(`KaspaRocket transaction refused: ${message}`);
    this.name = "KaspaRocketTxFormatError";
  }
}

const fail = (message: string): never => {
  throw new KaspaRocketTxFormatError(message);
};

const U64_MAX = (1n << 64n) - 1n;

type Obj = Record<string, unknown>;

function only(o: unknown, keys: readonly string[], name: string): Obj {
  if (!o || typeof o !== "object" || Array.isArray(o))
    fail(`${name} malformed`);
  for (const k of Object.keys(o as Obj)) {
    if (!keys.includes(k)) fail(`${name} carries an unknown field ${k}`);
  }
  return o as Obj;
}

/** A u64 as a decimal string, or as a JSON number while it is still exact. */
function u64(x: unknown, name: string): bigint {
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0)
    return BigInt(x);
  if (typeof x !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(x))
    fail(`bad ${name}`);
  const v = BigInt(x as string);
  if (v > U64_MAX) fail(`${name} out of range`);
  return v;
}

function int(x: unknown, max: number, name: string): number {
  if (!Number.isInteger(x) || (x as number) < 0 || (x as number) > max)
    fail(`bad ${name}`);
  return x as number;
}

function hexOf(x: unknown, name: string, bytes?: number): string {
  const re =
    bytes === undefined
      ? /^([0-9a-f]{2})*$/
      : new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
  if (typeof x !== "string" || !re.test(x)) fail(`bad ${name}`);
  return x as string;
}

/**
 * `scriptPublicKey` on the wire, either form: the safe-JSON hex string (2-byte
 * big-endian version, then the script), or the server's `{ version, script }`.
 */
function spkOf(x: unknown, name: string) {
  if (typeof x !== "string") {
    const o = only(x, ["version", "script"], name);
    const script = hexOf(o.script, `${name} script`);
    if (!script) fail(`bad ${name} script`);
    return { version: int(o.version, 0xffff, `${name} version`), script };
  }
  const s = hexOf(x, name);
  if (s.length < 6) fail(`bad ${name}`);
  return { version: parseInt(s.slice(0, 4), 16), script: s.slice(4) };
}

/** An outpoint, `{ transactionId, index }`, checked. */
function outpointOf(x: unknown, name: string) {
  const o = only(x, ["transactionId", "index"], name);
  return {
    transactionId: hexOf(o.transactionId, `${name} transactionId`, 32),
    index: int(o.index, 0xffffffff, `${name} index`),
  };
}

function inputOf(x: unknown, i: number): TxInput {
  const name = `input ${i}`;
  const o = only(
    x,
    [
      "transactionId",
      "index",
      "previousOutpoint",
      "sequence",
      "sigOpCount",
      "computeBudget",
      "signatureScript",
      "utxo",
    ],
    name,
  );
  const u = only(
    o.utxo,
    [
      "address",
      "amount",
      "scriptPublicKey",
      "blockDaaScore",
      "isCoinbase",
      "outpoint",
      "covenantId",
    ],
    `${name} coin`,
  );
  const flat = o.transactionId !== undefined || o.index !== undefined;
  if (flat === (o.previousOutpoint !== undefined))
    fail(`${name} needs exactly one outpoint form`);
  const previousOutpoint = flat
    ? outpointOf({ transactionId: o.transactionId, index: o.index }, name)
    : outpointOf(o.previousOutpoint, `${name} previousOutpoint`);
  if (u.outpoint !== undefined) {
    const c = outpointOf(u.outpoint, `${name} coin outpoint`);
    if (
      c.transactionId !== previousOutpoint.transactionId ||
      c.index !== previousOutpoint.index
    )
      fail(`${name} coin names another outpoint`);
  }
  const covenantId =
    u.covenantId == null
      ? undefined
      : hexOf(u.covenantId, `${name} coin covenantId`, 32);
  // A v1 sighash does not commit to the sig-op count; check it, don't carry it.
  int(o.sigOpCount, 255, `${name} sigOpCount`);
  if (typeof u.isCoinbase !== "boolean") fail(`bad ${name} isCoinbase`);
  if (u.address != null && typeof u.address !== "string")
    fail(`bad ${name} address`);
  const spk = spkOf(u.scriptPublicKey, `${name} scriptPublicKey`);
  return {
    previousOutpoint,
    signatureScript: hexOf(o.signatureScript, `${name} signatureScript`),
    sequence: u64(o.sequence, `${name} sequence`),
    // Outside the digest, but the node refuses the transaction without it.
    computeBudget:
      o.computeBudget === undefined
        ? 0
        : int(o.computeBudget, 0xffff, `${name} computeBudget`),
    utxo: {
      amount: u64(u.amount, `${name} amount`),
      scriptPublicKey: spk.script,
      scriptVersion: spk.version,
      blockDaaScore: u64(u.blockDaaScore, `${name} blockDaaScore`),
      isCoinbase: u.isCoinbase as boolean,
      ...(u.address ? { address: u.address as string } : {}),
      ...(covenantId ? { covenantId } : {}),
    },
  };
}

function outputOf(x: unknown, i: number, inputCount: number): TxOutput {
  const name = `output ${i}`;
  const o = only(x, ["value", "scriptPublicKey", "covenant"], name);
  const spk = spkOf(o.scriptPublicKey, `${name} scriptPublicKey`);
  const out: TxOutput = {
    value: u64(o.value, `${name} value`),
    scriptPublicKey: spk.script,
    scriptVersion: spk.version,
  };
  if (o.covenant != null) {
    const c = only(
      o.covenant,
      ["authorizingInput", "covenantId"],
      `${name} covenant`,
    );
    out.covenant = {
      authorizingInput: int(
        c.authorizingInput,
        inputCount - 1,
        `${name} authorizingInput`,
      ),
      covenantId: hexOf(c.covenantId, `${name} covenantId`, 32),
    };
  }
  return out;
}

/** One planned transaction's `tx` as a Tx, at most `KASPAROCKET_MAX_INPUTS` inputs. */
export function kasparocketPlanToTx(tx: PlannedTransaction["tx"]): Tx {
  const t = only(
    tx,
    [
      "id",
      "version",
      "inputs",
      "outputs",
      "subnetworkId",
      "lockTime",
      "gas",
      "mass",
      "storageMass",
      "payload",
    ],
    "transaction",
  );
  if (t.id !== undefined) hexOf(t.id, "id", 32);
  if (t.mass !== undefined) u64(t.mass, "mass");
  if (t.storageMass !== undefined) u64(t.storageMass, "storageMass");
  if (!Array.isArray(t.inputs) || !t.inputs.length) fail("no inputs");
  if (!Array.isArray(t.outputs) || !t.outputs.length) fail("no outputs");
  if ((t.inputs as unknown[]).length > KASPAROCKET_MAX_INPUTS) {
    fail(
      `${(t.inputs as unknown[]).length} inputs, more than ${KASPAROCKET_MAX_INPUTS}`,
    );
  }
  const inputs = (t.inputs as unknown[]).map(inputOf);
  return {
    version: int(t.version, 0xffff, "version"),
    inputs,
    outputs: (t.outputs as unknown[]).map((o, i) =>
      outputOf(o, i, inputs.length),
    ),
    lockTime: u64(t.lockTime, "lockTime"),
    subnetworkId: hexOf(t.subnetworkId, "subnetworkId", 20),
    gas: u64(t.gas, "gas"),
    payload: hexOf(t.payload, "payload"),
  };
}

export type KaspaRocketDigest = {
  /** Index in `plan.transactions`. */
  txIndex: number;
  inputIndex: number;
  /** The digest recomputed here from the plan object, hex. */
  digest: string;
  /** The digest the server says the input expects, hex; absent if it sent none. */
  prepared?: string;
};

/**
 * The v1 SIGHASH_ALL digest of every input the plan asks to be signed, one
 * per signing instruction, computed locally from the plan's own transaction
 * (it carries the output covenants a v1 digest commits to).
 */
export function planDigests(plan: TransactionPlan): KaspaRocketDigest[] {
  return plan.transactions.flatMap((planned, txIndex) => {
    const tx = kasparocketPlanToTx(planned.tx);
    return instructionsToSign(planned).map((ins) => {
      const i = ins.inputIndex;
      if (!Number.isInteger(i) || i < 0 || i >= tx.inputs.length) {
        fail(`input ${i} is not in transaction ${txIndex}`);
      }
      return {
        txIndex,
        inputIndex: i,
        digest: bytesToHex(schnorrSighash(tx, i)).slice(2),
        ...(ins.sighash !== undefined ? { prepared: ins.sighash } : {}),
      };
    });
  });
}
