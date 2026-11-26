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
 * rusty-kaspa safe-JSON the SDK hands a signer (`PlannedTransaction.tx`,
 * left unparsed by the SDK). Strict: any field this reader does not know is
 * refused, so a digest is never computed over a transaction it half read.
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

/** `scriptPublicKey` on the wire: 2-byte big-endian version, then the script. */
function spkOf(x: unknown, name: string) {
  const s = hexOf(x, name);
  if (s.length < 6) fail(`bad ${name}`);
  return { version: parseInt(s.slice(0, 4), 16), script: s.slice(4) };
}

function inputOf(x: unknown, i: number): TxInput {
  const name = `input ${i}`;
  const o = only(
    x,
    [
      "transactionId",
      "index",
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
    ["address", "amount", "scriptPublicKey", "blockDaaScore", "isCoinbase"],
    `${name} coin`,
  );
  // A v1 sighash does not commit to the sig-op count; check it, don't carry it.
  int(o.sigOpCount, 255, `${name} sigOpCount`);
  if (typeof u.isCoinbase !== "boolean") fail(`bad ${name} isCoinbase`);
  if (u.address != null && typeof u.address !== "string")
    fail(`bad ${name} address`);
  const spk = spkOf(u.scriptPublicKey, `${name} scriptPublicKey`);
  return {
    previousOutpoint: {
      transactionId: hexOf(o.transactionId, `${name} transactionId`, 32),
      index: int(o.index, 0xffffffff, `${name} index`),
    },
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
      "payload",
    ],
    "transaction",
  );
  if (t.id !== undefined) hexOf(t.id, "id", 32);
  if (t.mass !== undefined) u64(t.mass, "mass");
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
