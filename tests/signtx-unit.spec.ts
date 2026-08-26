import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blake2b } from "@noble/hashes/blake2b";
import { schnorr } from "@noble/curves/secp256k1";
import init, {
  createInputSignature,
  createTransactions,
  payToAddressScript,
  PrivateKey,
  ScriptBuilder,
  SighashType,
  Transaction,
} from "@/wasm/core/kaspa";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  LedgerAccount,
  LegacyLedgerAccount,
} from "@/lib/wallet/account/ledger-account";
import {
  hasPartialOutputCommitment,
  hasScriptOptions,
  hasUnsignableFields,
  normalizeScriptOptions,
  pushDataHex,
  signTxInputWithScriptOption,
  signTxWithScriptOptions,
  type RawScriptOption,
} from "@/lib/wallet/sign-script";
import { SIGN_TYPE, toSignType } from "@/lib/kaspa";
import { SignTxPayloadSchema } from "@/api/background/handlers/kaspa/utils";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/wallet/account-factory";
import { withOwned } from "@/lib/wallet/wasm-lifecycle";
import type { SignType } from "@/lib/wallet/wallet-interface";

// Throwaway key — unit tests only, never funded.
const TEST_KEY =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = path.join(
  TESTS_DIR,
  "../test/fixtures/kaspacom-signtx-repro.txt",
);

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const match = raw.match(/signTx\(\s*'([^']+)',\s*'(.*)',\s*(\[.*\])\s*\)/s);
  if (!match) throw new Error("cannot parse repro fixture");
  return {
    networkId: match[1],
    txJson: match[2],
    scripts: JSON.parse(match[3]) as (RawScriptOption & {
      inputIndex: number;
      scriptHex: string;
    })[],
  };
}

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

test.describe("signTx covenant repro (kaspa.com fixture)", () => {
  test("prepares the full repro tx for signing without throwing", async () => {
    const { txJson, scripts } = loadFixture();
    const original = JSON.parse(txJson);

    // Same chain as the extension: popup deserialize -> serialize for IPC ->
    // background deserialize -> sign.
    const popupTx = deserializeTransaction(txJson);
    const backgroundTx = deserializeTransaction(popupTx.serializeToSafeJSON());

    const prefilledSigScript = original.inputs[0].signatureScript;
    expect(prefilledSigScript).not.toBe("");
    expect(original.inputs[1].signatureScript).toBe("");

    const signed = await signTxWithScriptOptions(
      backgroundTx,
      scripts,
      TEST_KEY,
    );
    const result = JSON.parse(signed.serializeToSafeJSON());

    // Scripted P2SH input got populated: push-encoded signature followed by
    // the canonical push of the supplied redeem script.
    const sigScript = result.inputs[1].signatureScript;
    expect(sigScript).not.toBe("");
    expect(sigScript.endsWith(pushDataHex(scripts[0].scriptHex))).toBe(true);
    expect(sigScript.startsWith("41")).toBe(true); // OpData65: 64-byte sig + hashtype

    // Pre-filled input untouched.
    expect(result.inputs[0].signatureScript).toBe(prefilledSigScript);

    // v1 / covenant fields survived the whole pipeline unchanged.
    expect(result.version).toBe(original.version);
    expect(result.payload).toBe(original.payload);
    expect(result.outputs.map((o: any) => o.covenant ?? null)).toEqual(
      original.outputs.map((o: any) => o.covenant ?? null),
    );
    expect(result.inputs.map((i: any) => i.utxo.covenantId ?? null)).toEqual(
      original.inputs.map((i: any) => i.utxo.covenantId ?? null),
    );
    expect(result.inputs.map((i: any) => i.computeBudget)).toEqual(
      original.inputs.map((i: any) => i.computeBudget),
    );
    expect(result.inputs.map((i: any) => i.utxo.scriptPublicKey)).toEqual(
      original.inputs.map((i: any) => i.utxo.scriptPublicKey),
    );
  });

  test("tolerates a sparse sign options array", async () => {
    const { txJson, scripts } = loadFixture();
    const tx = deserializeTransaction(txJson);
    const sparse = [null, undefined, ...scripts];

    const signed = await signTxWithScriptOptions(tx, sparse as any, TEST_KEY);
    expect(
      JSON.parse(signed.serializeToSafeJSON()).inputs[1].signatureScript,
    ).not.toBe("");
  });

  test("accepts `script` as an alias for `scriptHex`", async () => {
    expect(normalizeScriptOptions([{ inputIndex: 1, script: "aabb" }])).toEqual(
      [{ inputIndex: 1, scriptHex: "aabb", signType: "All" }],
    );
    // documented key wins when both are present
    expect(
      normalizeScriptOptions([
        { inputIndex: 1, scriptHex: "aabb", script: "ccdd" },
      ]),
    ).toEqual([{ inputIndex: 1, scriptHex: "aabb", signType: "All" }]);

    const { txJson, scripts } = loadFixture();
    const tx = deserializeTransaction(txJson);
    const aliased = [
      { inputIndex: 1, script: scripts[0].scriptHex, signType: "All" },
    ];
    const signed = await signTxWithScriptOptions(tx, aliased as any, TEST_KEY);
    const sigScript = JSON.parse(signed.serializeToSafeJSON()).inputs[1]
      .signatureScript;
    expect(sigScript.endsWith(pushDataHex(scripts[0].scriptHex))).toBe(true);
  });

  test("accepts scriptPublicKey as hex string or {version, script} object", async () => {
    const { txJson, scripts } = loadFixture();

    // fixture uses the hex-string form; rewrite every occurrence to object form
    const tx = JSON.parse(txJson);
    const toObject = (spk: string) => ({
      version: parseInt(spk.slice(0, 4), 16),
      script: spk.slice(4),
    });
    tx.inputs.forEach((i: any) => {
      i.utxo.scriptPublicKey = toObject(i.utxo.scriptPublicKey);
    });
    tx.outputs.forEach((o: any) => {
      o.scriptPublicKey = toObject(o.scriptPublicKey);
    });

    const objectFormTx = deserializeTransaction(JSON.stringify(tx));
    const signed = await signTxWithScriptOptions(
      objectFormTx,
      scripts,
      TEST_KEY,
    );
    expect(
      JSON.parse(signed.serializeToSafeJSON()).inputs[1].signatureScript,
    ).not.toBe("");
  });

  test("rejects with structured errors instead of raw TypeErrors", async () => {
    const { txJson, scripts } = loadFixture();

    await expect(
      signTxWithScriptOptions(
        deserializeTransaction(txJson),
        [{ inputIndex: 99, scriptHex: "aa" }],
        TEST_KEY,
      ),
    ).rejects.toThrow("signTx: sign option references non-existent input 99");

    await expect(
      signTxWithScriptOptions(
        deserializeTransaction(txJson),
        [{ scriptHex: "aa" } as any],
        TEST_KEY,
      ),
    ).rejects.toThrow("signTx: sign option has invalid inputIndex undefined");

    await expect(
      signTxWithScriptOptions(
        deserializeTransaction(txJson),
        [{ inputIndex: 1, scriptHex: "not-hex" }],
        TEST_KEY,
      ),
    ).rejects.toThrow("signTx: invalid scriptHex for input 1");

    await expect(
      signTxWithScriptOptions(
        deserializeTransaction(txJson),
        [{ inputIndex: 1, scriptHex: "aa", signType: "Bogus" as any }],
        TEST_KEY,
      ),
    ).rejects.toThrow('signTx: unsupported signType "Bogus"');

    // inherited object keys must not resolve to sighash types, and neither
    // may near-miss evasions of the refused names: lowercase, trailing
    // whitespace, or the raw numeric enum value (2 = SighashType.None).
    // Each must throw before any signature is produced.
    for (const badType of [
      "toString",
      "constructor",
      "__proto__",
      "none",
      "None ",
      2,
    ]) {
      const evasionTx = deserializeTransaction(txJson);
      await expect(
        signTxWithScriptOptions(
          evasionTx,
          [{ inputIndex: 1, scriptHex: "aa", signType: badType as any }],
          TEST_KEY,
        ),
      ).rejects.toThrow(`signTx: unsupported signType "${badType}"`);
      expect(
        JSON.parse(evasionTx.serializeToSafeJSON()).inputs[1].signatureScript,
      ).toBe("");
    }

    await expect(
      signTxWithScriptOptions(
        deserializeTransaction(txJson),
        [
          { inputIndex: 1, scriptHex: "aa" },
          { inputIndex: 1, scriptHex: "aa" },
        ],
        TEST_KEY,
      ),
    ).rejects.toThrow("signTx: duplicate sign option for input 1");

    // a bad option must fail the call before any input is mutated
    {
      const tx = deserializeTransaction(txJson);
      await expect(
        signTxWithScriptOptions(
          tx,
          [
            { inputIndex: 1, scriptHex: scripts[0].scriptHex },
            { inputIndex: 99, scriptHex: "aa" },
          ],
          TEST_KEY,
        ),
      ).rejects.toThrow("signTx: sign option references non-existent input 99");
      expect(
        JSON.parse(tx.serializeToSafeJSON()).inputs[1].signatureScript,
      ).toBe("");
    }

    // option targeting the pre-filled covenant input must not mutate it
    const tx = deserializeTransaction(txJson);
    const before = JSON.parse(tx.serializeToSafeJSON()).inputs[0]
      .signatureScript;
    await expect(
      signTxWithScriptOptions(
        tx,
        [{ inputIndex: 0, scriptHex: scripts[0].scriptHex }],
        TEST_KEY,
      ),
    ).rejects.toThrow("signTx: input 0 already carries a signatureScript");
    expect(JSON.parse(tx.serializeToSafeJSON()).inputs[0].signatureScript).toBe(
      before,
    );
  });

  test("pushDataHex matches the SDK encoder below its 520-byte cap and uses OpPushData2 above it", () => {
    const sig = "ab".repeat(66);
    for (const redeem of ["515253", "52".repeat(80), "53".repeat(300)]) {
      const sdk =
        ScriptBuilder.fromScript(redeem).encodePayToScriptHashSignatureScript(
          sig,
        );
      expect(sig + pushDataHex(redeem)).toBe(sdk);
    }

    // the repro's 8076-byte redeem script overflows the SDK's element cap;
    // our encoder must produce a canonical OpPushData2 push instead
    const { scripts } = loadFixture();
    const big = scripts[0].scriptHex;
    const byteLen = big.length / 2;
    expect(byteLen).toBeGreaterThan(520);
    const le16 =
      (byteLen & 0xff).toString(16).padStart(2, "0") +
      (byteLen >> 8).toString(16).padStart(2, "0");
    expect(pushDataHex(big)).toBe("4d" + le16 + big);
  });
});

// Independent KIP-12 check: recompute the sighash outside the WASM and verify
// the WASM-produced schnorr signature against it. Proves the signed message
// commits to tx.payload.
test.describe("sighash payload coverage (KIP-12)", () => {
  const KEY_BYTES = new TextEncoder().encode("TransactionSigningHash");
  const keyedHash = (data: Uint8Array) =>
    blake2b(data, { dkLen: 32, key: KEY_BYTES });
  const hex2b = (h: string) =>
    Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
  const u64le = (n: number | string | bigint) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
    return b;
  };
  const u16le = (n: number) => Uint8Array.of(n & 0xff, n >> 8);
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  };

  // Consensus wire byte per sighash type (rusty-kaspa SigHashType bits); the
  // SIGN_TYPE enum values are just indices into this set. Note AllAnyOneCanPay
  // is the bare ANY_ONE_CAN_PAY bit, not ALL|ANY_ONE_CAN_PAY — the type-name
  // arithmetic would give 0x81. Every byte here is asserted against the byte
  // the WASM signer actually emits, below.
  const HASH_TYPE_BYTE: Record<SignType, number> = {
    All: 0b0000_0001,
    None: 0b0000_0010,
    Single: 0b0000_0100,
    AllAnyOneCanPay: 0b1000_0000,
    NoneAnyOneCanPay: 0b1000_0010,
    SingleAnyOneCanPay: 0b1000_0100,
  };

  const ZERO32 = new Uint8Array(32);
  const hashOutput = (o: any) =>
    cat(
      u64le(o.value),
      u16le(parseInt(o.scriptPublicKey.slice(0, 4), 16)),
      u64le((o.scriptPublicKey.length - 4) / 2),
      hex2b(o.scriptPublicKey.slice(4)),
    );

  // Signing preimage per rusty-kaspa's TransactionSigningHash, including the
  // field masking each sighash type applies. This is what makes the
  // output-commitment claims below verifiable rather than assumed.
  function sighashFor(tx: any, inputIndex: number, type: SignType = "All") {
    const anyoneCanPay = type.endsWith("AnyOneCanPay");
    const isNone = type.startsWith("None");
    const isSingle = type.startsWith("Single");

    const prevouts = anyoneCanPay
      ? ZERO32
      : keyedHash(
          cat(
            ...tx.inputs.map((i: any) =>
              cat(hex2b(i.transactionId), new Uint8Array(4)),
            ),
          ),
        );
    const sequences =
      anyoneCanPay || isNone || isSingle
        ? ZERO32
        : keyedHash(cat(...tx.inputs.map((i: any) => u64le(i.sequence))));
    const sigOpCounts = anyoneCanPay
      ? ZERO32
      : keyedHash(
          cat(...tx.inputs.map((i: any) => Uint8Array.of(i.sigOpCount))),
        );
    // None commits no outputs at all; Single commits only the same-index one.
    const outputs = isNone
      ? ZERO32
      : isSingle
        ? inputIndex >= tx.outputs.length
          ? ZERO32
          : keyedHash(hashOutput(tx.outputs[inputIndex]))
        : keyedHash(cat(...tx.outputs.map(hashOutput)));
    // KIP-12: payload committed as keyed hash of length-prefixed payload bytes
    const payloadHash =
      tx.payload && tx.payload.length > 0
        ? keyedHash(cat(u64le(tx.payload.length / 2), hex2b(tx.payload)))
        : new Uint8Array(32);

    const input = tx.inputs[inputIndex];
    const spk = input.utxo.scriptPublicKey;
    return keyedHash(
      cat(
        u16le(tx.version),
        prevouts,
        sequences,
        sigOpCounts,
        hex2b(input.transactionId),
        new Uint8Array(4), // outpoint index (u32)
        u16le(parseInt(spk.slice(0, 4), 16)),
        u64le((spk.length - 4) / 2),
        hex2b(spk.slice(4)),
        u64le(input.utxo.amount),
        u64le(input.sequence),
        Uint8Array.of(input.sigOpCount),
        outputs,
        u64le(tx.lockTime),
        hex2b(tx.subnetworkId),
        u64le(tx.gas),
        payloadHash,
        Uint8Array.of(HASH_TYPE_BYTE[type]),
      ),
    );
  }

  // The claim the None* block and the Single* warning rest on: how much of the
  // output set each sighash type actually commits to. Proven against the WASM
  // signer rather than assumed — a signature only verifies if our preimage,
  // including its output masking, matches what the WASM signed.
  test("output commitment per sighash type matches the masking we gate on", () => {
    const priv = new PrivateKey(TEST_KEY);
    const pubX = priv.toPublicKey().toXOnlyPublicKey().toString();
    const spk = "0000" + "20" + pubX + "ac";
    const mkTx = (out0: string, out1: string) => ({
      id: "00".repeat(32),
      version: 0,
      inputs: [
        {
          transactionId: "11".repeat(32),
          index: 0,
          sequence: "0",
          sigOpCount: 1,
          computeBudget: 0,
          signatureScript: "",
          utxo: {
            address: null,
            amount: "100000000",
            scriptPublicKey: spk,
            blockDaaScore: "1000",
            isCoinbase: false,
          },
        },
      ],
      outputs: [
        { value: out0, scriptPublicKey: spk },
        { value: out1, scriptPublicKey: spk },
      ],
      lockTime: "0",
      subnetworkId: "00".repeat(20),
      gas: "0",
      payload: "",
    });

    const base = mkTx("40000000", "40000000");
    const sameIndexChanged = mkTx("10000000", "40000000"); // output 0 rewritten
    const otherIndexChanged = mkTx("40000000", "10000000"); // output 1 rewritten

    // outputs the signature is expected to bind, per type
    const commits: Record<
      SignType,
      { sameIndex: boolean; otherIndex: boolean }
    > = {
      All: { sameIndex: true, otherIndex: true },
      AllAnyOneCanPay: { sameIndex: true, otherIndex: true },
      Single: { sameIndex: true, otherIndex: false },
      SingleAnyOneCanPay: { sameIndex: true, otherIndex: false },
      None: { sameIndex: false, otherIndex: false },
      NoneAnyOneCanPay: { sameIndex: false, otherIndex: false },
    };

    for (const type of Object.keys(SIGN_TYPE) as SignType[]) {
      const wasmTx = Transaction.deserializeFromSafeJSON(JSON.stringify(base));
      const sigScript = createInputSignature(wasmTx, 0, priv, toSignType(type));
      const sig64 = hex2b(sigScript.slice(2, 2 + 128));

      // the trailing byte of the signature is the consensus hash-type byte
      expect(sigScript.slice(2 + 128)).toBe(
        HASH_TYPE_BYTE[type].toString(16).padStart(2, "0"),
      );

      // our masked preimage reproduces exactly what the WASM signed
      expect(
        schnorr.verify(sig64, sighashFor(base, 0, type), hex2b(pubX)),
      ).toBe(true);

      // a signature that commits an output cannot survive that output changing
      expect(
        schnorr.verify(
          sig64,
          sighashFor(sameIndexChanged, 0, type),
          hex2b(pubX),
        ),
      ).toBe(!commits[type].sameIndex);
      expect(
        schnorr.verify(
          sig64,
          sighashFor(otherIndexChanged, 0, type),
          hex2b(pubX),
        ),
      ).toBe(!commits[type].otherIndex);
    }
  });

  test("a payload-bearing tx signs a different sighash than the same tx with empty payload", () => {
    const priv = new PrivateKey(TEST_KEY);
    const pubX = priv.toPublicKey().toXOnlyPublicKey().toString();
    const spk = "0000" + "20" + pubX + "ac";
    const mkTx = (payload: string) => ({
      id: "00".repeat(32),
      version: 0,
      inputs: [
        {
          transactionId: "11".repeat(32),
          index: 0,
          sequence: "0",
          sigOpCount: 1,
          computeBudget: 0,
          signatureScript: "",
          utxo: {
            address: null,
            amount: "100000000",
            scriptPublicKey: spk,
            blockDaaScore: "1000",
            isCoinbase: false,
          },
        },
      ],
      outputs: [{ value: "90000000", scriptPublicKey: spk }],
      lockTime: "0",
      subnetworkId: "00".repeat(20),
      gas: "0",
      payload,
    });

    const withPayload = mkTx("beef1234");
    const withoutPayload = mkTx("");

    const hashWith = sighashFor(withPayload, 0);
    const hashWithout = sighashFor(withoutPayload, 0);
    expect(Buffer.from(hashWith).toString("hex")).not.toBe(
      Buffer.from(hashWithout).toString("hex"),
    );

    for (const tx of [withPayload, withoutPayload]) {
      const wasmTx = Transaction.deserializeFromSafeJSON(JSON.stringify(tx));
      const sigScript = createInputSignature(wasmTx, 0, priv, SighashType.All);
      // strip push opcode (1 byte) and trailing sighash-type byte
      const sig64 = hex2b(sigScript.slice(2, 2 + 128));

      // WASM signature verifies against OUR sighash for the same payload...
      expect(schnorr.verify(sig64, sighashFor(tx, 0), hex2b(pubX))).toBe(true);
      // ...and NOT against the sighash with the payload flipped — so the
      // signed message really commits to tx.payload.
      const flipped = tx === withPayload ? withoutPayload : withPayload;
      expect(schnorr.verify(sig64, sighashFor(flipped, 0), hex2b(pubX))).toBe(
        false,
      );
    }
  });
});

test.describe("sighash safety policy (U1)", () => {
  const fixtureTx = () => deserializeTransaction(loadFixture().txJson);

  test("refuses sighash types that commit no outputs", async () => {
    for (const signType of ["None", "NoneAnyOneCanPay"] as const) {
      expect(() =>
        normalizeScriptOptions([
          { inputIndex: 1, scriptHex: "aabb", signType },
        ]),
      ).toThrow(
        `signTx: signType "${signType}" commits no outputs, so every output could be rewritten after signing; refusing to sign input 1`,
      );

      await expect(
        signTxWithScriptOptions(
          fixtureTx(),
          [{ inputIndex: 1, scriptHex: "aabb", signType }],
          TEST_KEY,
        ),
      ).rejects.toThrow(`signTx: signType "${signType}" commits no outputs`);
    }
  });

  test("signTxInputWithScriptOption refuses None* when called directly, bypassing normalization", () => {
    for (const signType of ["None", "NoneAnyOneCanPay"] as const) {
      const tx = fixtureTx();
      expect(() =>
        signTxInputWithScriptOption(
          tx,
          { inputIndex: 1, scriptHex: "aabb", signType },
          TEST_KEY,
        ),
      ).toThrow(
        `signTx: signType "${signType}" commits no outputs, so every output could be rewritten after signing; refusing to sign input 1`,
      );
      expect(
        JSON.parse(tx.serializeToSafeJSON()).inputs[1].signatureScript,
      ).toBe("");
    }
  });

  test("a blocked option fails the call before any input is mutated", async () => {
    const { txJson, scripts } = loadFixture();
    const tx = deserializeTransaction(txJson);
    await expect(
      signTxWithScriptOptions(
        tx,
        [
          { inputIndex: 1, scriptHex: scripts[0].scriptHex },
          { inputIndex: 2, scriptHex: "aabb", signType: "None" },
        ],
        TEST_KEY,
      ),
    ).rejects.toThrow('signTx: signType "None" commits no outputs');
    expect(JSON.parse(tx.serializeToSafeJSON()).inputs[1].signatureScript).toBe(
      "",
    );
  });

  test("partial-commitment sighash types stay signable (KaspaCom PSKT listings)", async () => {
    const { txJson, scripts } = loadFixture();
    for (const signType of ["Single", "SingleAnyOneCanPay"] as const) {
      expect(
        normalizeScriptOptions([
          { inputIndex: 1, scriptHex: "aabb", signType },
        ]),
      ).toEqual([{ inputIndex: 1, scriptHex: "aabb", signType }]);

      const tx = deserializeTransaction(txJson);
      const signed = await signTxWithScriptOptions(
        tx,
        [{ inputIndex: 1, scriptHex: scripts[0].scriptHex, signType }],
        TEST_KEY,
      );
      expect(
        JSON.parse(signed.serializeToSafeJSON()).inputs[1].signatureScript,
      ).not.toBe("");
    }
  });

  test("full-commitment sighash types stay signable and default to All", async () => {
    const { txJson, scripts } = loadFixture();
    for (const signType of ["All", "AllAnyOneCanPay"] as const) {
      expect(
        normalizeScriptOptions([
          { inputIndex: 1, scriptHex: "aabb", signType },
        ]),
      ).toEqual([{ inputIndex: 1, scriptHex: "aabb", signType }]);
    }

    // absent signType resolves to All
    expect(
      normalizeScriptOptions([{ inputIndex: 1, scriptHex: "aabb" }]),
    ).toEqual([{ inputIndex: 1, scriptHex: "aabb", signType: "All" }]);

    const signed = await signTxWithScriptOptions(
      deserializeTransaction(txJson),
      scripts,
      TEST_KEY,
    );
    expect(
      JSON.parse(signed.serializeToSafeJSON()).inputs[1].signatureScript,
    ).not.toBe("");
  });

  test("warns only for sighash types that commit part of the outputs", () => {
    for (const signType of ["Single", "SingleAnyOneCanPay"] as const) {
      expect(hasPartialOutputCommitment([{ inputIndex: 0, signType }])).toBe(
        true,
      );
      // one flagged option among safe ones is enough to warn
      expect(
        hasPartialOutputCommitment([
          { inputIndex: 0, signType: "All" },
          { inputIndex: 1, signType },
        ]),
      ).toBe(true);
    }

    for (const signType of ["All", "AllAnyOneCanPay"] as const) {
      expect(hasPartialOutputCommitment([{ inputIndex: 0, signType }])).toBe(
        false,
      );
    }
    expect(hasPartialOutputCommitment([{ inputIndex: 0 }])).toBe(false);
    expect(hasPartialOutputCommitment([null, undefined])).toBe(false);
    expect(hasPartialOutputCommitment([])).toBe(false);
    expect(hasPartialOutputCommitment(undefined)).toBe(false);
  });

  test("toSignType keeps its prototype-pollution guard", () => {
    for (const protoKey of ["__proto__", "toString", "constructor"]) {
      expect(() => toSignType(protoKey as any)).toThrow(
        `signTx: unsupported signType "${protoKey}"`,
      );
    }
    for (const signType of Object.keys(SIGN_TYPE) as SignType[]) {
      expect(toSignType(signType)).toBe(SIGN_TYPE[signType]);
    }
  });
});

// F7: the address the user is shown and the key that signs must come from the
// same derivation index. Driving a real Ledger needs a Transport, so this is a
// source-level assertion on the hook that builds both.
test.describe("ledger signer index parity (F7)", () => {
  test("every createFromLedger call in useKaspaLedgerSigner passes an index", () => {
    const source = fs.readFileSync(
      path.join(TESTS_DIR, "../hooks/wallet/useKaspaLedgerSigner.ts"),
      "utf8",
    );
    const calls = [...source.matchAll(/createFromLedger\(([^)]*)\)/g)].map(
      (m) => m[1].split(",").map((a) => a.trim()),
    );
    expect(calls.length).toBeGreaterThan(1);
    for (const args of calls) {
      expect(args).toEqual(["transport", "accountIndex"]);
    }
  });
});

// L1: the payload schema defaults `scripts` to [], so consumers must gate on
// actual script options — a bare existence check is always truthy and refused
// every dApp signTx routed to a Ledger account (the v2.59.1 outage).
// hasScriptOptions drives: the LedgerSignAndBroadcast gate, the
// wallet.signTx call-site normalization ([] -> undefined) in both confirm
// screens, and the refusal-message selection in LedgerSignTx (sign-only is
// always refused on Ledger until KAS-002 items 2 and 3, but script-bearing
// and script-free requests must get different reasons).
test.describe("ledger script gate (L1)", () => {
  test("empty scripts array is not a script-bearing request", () => {
    expect(hasScriptOptions([])).toBe(false);
  });

  test("absent scripts gets the schema default and is not refused", () => {
    const parsed = SignTxPayloadSchema.parse({ txJson: "{}" });
    expect(parsed.scripts).toEqual([]);
    expect(hasScriptOptions(parsed.scripts)).toBe(false);
  });

  test("script-bearing requests still trip the gate", () => {
    expect(hasScriptOptions([{ inputIndex: 0, scriptHex: "aabb" }])).toBe(true);
    const parsed = SignTxPayloadSchema.parse({
      txJson: "{}",
      scripts: [{ inputIndex: 0, scriptHex: "aabb" }],
    });
    expect(hasScriptOptions(parsed.scripts)).toBe(true);
  });

  test("sparse arrays count only real options", () => {
    expect(hasScriptOptions([null, undefined] as any)).toBe(false);
    expect(hasScriptOptions(undefined)).toBe(false);
    expect(
      hasScriptOptions([null, { inputIndex: 1, scriptHex: "aabb" }] as any),
    ).toBe(true);
  });
});

// A1: fields the Ledger device provably does not sign over. hw-app-kaspa's
// APDU frame carries only value/prevTxId/outpointIndex/addressType/
// addressIndex per input, and the Ledger app hardcodes version, lockTime,
// gas, subnetworkId, payload and every input sequence to zero in its sighash
// (and forces SIGHASH_ALL). Any non-default value still yields a VALID
// signature — over the zeroed rewrite — so LedgerSignAndBroadcast refuses
// these upfront via hasUnsignableFields. The React screens have no component
// harness, so the predicate is what gets covered here. Unblock: KAS-002 A2.
test.describe("ledger unsignable-field gate (A1)", () => {
  const NATIVE_SUBNETWORK = "00".repeat(20);
  const SPK = "0000" + "20" + "ab".repeat(32) + "ac";

  const mkTxJson = (
    overrides: Record<string, unknown> = {},
    inputOverrides: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      id: "00".repeat(32),
      version: 0,
      inputs: [
        {
          transactionId: "11".repeat(32),
          index: 0,
          sequence: "0",
          sigOpCount: 1,
          computeBudget: 0,
          signatureScript: "",
          utxo: {
            address: null,
            amount: "100000000",
            scriptPublicKey: SPK,
            blockDaaScore: "1000",
            isCoinbase: false,
          },
          ...inputOverrides,
        },
      ],
      outputs: [{ value: "90000000", scriptPublicKey: SPK }],
      lockTime: "0",
      subnetworkId: NATIVE_SUBNETWORK,
      gas: "0",
      payload: "",
      ...overrides,
    });

  const txWith = (
    overrides: Record<string, unknown> = {},
    inputOverrides: Record<string, unknown> = {},
  ) => Transaction.deserializeFromSafeJSON(mkTxJson(overrides, inputOverrides));

  test("a fully-default transaction is signable", () => {
    expect(hasUnsignableFields(txWith())).toBe(false);
  });

  test("every field the device zeroes trips the gate", () => {
    expect(hasUnsignableFields(txWith({ lockTime: "5" }))).toBe(true);
    expect(hasUnsignableFields(txWith({ gas: "1" }))).toBe(true);
    expect(hasUnsignableFields(txWith({ payload: "beef" }))).toBe(true);
    expect(
      hasUnsignableFields(txWith({ subnetworkId: "01" + "00".repeat(19) })),
    ).toBe(true);
    expect(hasUnsignableFields(txWith({ version: 1 }))).toBe(true);
    expect(hasUnsignableFields(txWith({}, { sequence: "1" }))).toBe(true);
    expect(
      hasUnsignableFields(txWith({}, { sequence: "18446744073709551615" })),
    ).toBe(true);
  });

  test("empty payload variants are signable", () => {
    const base = {
      version: 0,
      lockTime: 0n,
      gas: 0n,
      subnetworkId: NATIVE_SUBNETWORK,
      inputs: [{ sequence: 0n }],
    };
    for (const payload of [undefined, null, "", "0x"]) {
      expect(hasUnsignableFields({ ...base, payload } as any)).toBe(false);
    }
  });

  test("malformed transactions do not throw and fail closed", () => {
    const base = {
      version: 0,
      lockTime: 0n,
      gas: 0n,
      payload: "",
      subnetworkId: NATIVE_SUBNETWORK,
    };
    // sparse inputs: a hole is an input whose sequence cannot be proven zero
    expect(
      hasUnsignableFields({ ...base, inputs: [null, undefined] } as any),
    ).toBe(true);
    // non-iterable inputs cannot be proven safe either
    expect(hasUnsignableFields({ ...base, inputs: 5 } as any)).toBe(true);
    expect(hasUnsignableFields(null as any)).toBe(true);
    expect(hasUnsignableFields({} as any)).toBe(true);
    // no inputs at all: nothing carries a sequence, nothing to refuse
    expect(hasUnsignableFields({ ...base, inputs: [] } as any)).toBe(false);
  });

  // S3: the internal Send flow (ConfirmStep) builds its transaction with the
  // WASM Generator and sets none of the guarded fields — prove the gate is a
  // no-op for Generator output so it can never brick internal Send.
  test("a Generator-built transaction (internal Send flow shape) passes the gate", async () => {
    const address = new PrivateKey(TEST_KEY).toPublicKey().toAddress("mainnet");
    const { transactions } = await createTransactions({
      entries: [
        {
          address,
          outpoint: { transactionId: "11".repeat(32), index: 0 },
          amount: 500_000_000n,
          scriptPublicKey: payToAddressScript(address),
          blockDaaScore: 1_000n,
          isCoinbase: false,
        },
      ],
      outputs: [{ address, amount: 100_000_000n }],
      priorityFee: 0n,
      changeAddress: address,
      networkId: "mainnet",
    });
    expect(transactions.length).toBeGreaterThan(0);
    for (const pending of transactions) {
      expect(hasUnsignableFields(pending.transaction)).toBe(false);
    }
  });
});

// B2/C/D: the Ledger derivation. app-kaspa builds the signing path per input as
// 44'/111111'/<account>'/<addressType>/<addressIndex> (src/crypto.c,
// bip32_path[2..4]) and validates change against the same account with
// change_address_type/change_address_index (src/transaction/tx_validate.c).
// Before this fix LedgerAccount overrode only `path`, so its addresses came
// from .../0'/0/{i} while the inherited signTx told the device .../{i}'/0/0 —
// equal only at i=0, and a wrong-key signature at every other index. These
// assert the emitted numbers directly, because a source-regex test cannot see
// an inherited method. Driving a real device needs a Transport, so the
// hw-app-kaspa client is stubbed.
test.describe("ledger derivation unification (B2/C/D)", () => {
  const NATIVE_SUBNETWORK = "00".repeat(20);
  const SPK = "0000" + "20" + "ab".repeat(32) + "ac";
  // BIP-340 test-vector public key, so `new PublicKey(...)` accepts it.
  const STUB_PUBKEY =
    "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659";

  const mkTxJson = (
    inputOverrides: Record<string, unknown> = {},
    outputValue = "90000000",
    inputCount = 1,
  ) =>
    JSON.stringify({
      id: "00".repeat(32),
      version: 0,
      inputs: Array.from({ length: inputCount }, (_unused, i) => ({
        transactionId: `${i.toString(16).padStart(2, "0")}`.repeat(32),
        index: i,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: "",
        utxo: {
          address: null,
          amount: "100000000",
          scriptPublicKey: SPK,
          blockDaaScore: "1000",
          isCoinbase: false,
        },
        ...inputOverrides,
      })),
      outputs: [{ value: outputValue, scriptPublicKey: SPK }],
      lockTime: "0",
      subnetworkId: NATIVE_SUBNETWORK,
      gas: "0",
      payload: "",
    });

  type Captured = {
    account: number;
    changeAddressType: number;
    changeAddressIndex: number;
    inputs: {
      addressType: number;
      addressIndex: number;
      value: number;
      prevTxId: string;
      outpointIndex: number;
    }[];
    outputs: { value: number }[];
  };

  const instrument = (account: LegacyLedgerAccount) => {
    const paths: string[] = [];
    const signed: Captured[] = [];
    const messageArgs: unknown[][] = [];

    (account as unknown as { app: unknown }).app = {
      getPublicKey: async (p: string) => {
        paths.push(p);
        return Buffer.concat([
          Buffer.from([32]),
          Buffer.from(STUB_PUBKEY, "hex"),
        ]);
      },
      signTransaction: async (tx: Captured) => {
        signed.push(tx);
        for (const input of tx.inputs) {
          (input as { signature?: string }).signature = "ab".repeat(64);
        }
      },
      signMessage: async (...args: unknown[]) => {
        messageArgs.push(args);
        return { signature: "ab".repeat(64) };
      },
    };

    return { paths, signed, messageArgs };
  };

  const signAndCapture = async (
    account: LegacyLedgerAccount,
    json = mkTxJson(),
  ) => {
    const stub = instrument(account);
    await account.signTx(deserializeTransaction(json));
    return stub.signed[0];
  };

  // The constructor only wires up the hw-app-kaspa client, which `instrument`
  // replaces anyway, and its default export is not callable under the test
  // loader. Build the instance off the prototype so method dispatch — the thing
  // under test, since the bug was an inherited signTx — stays real.
  const accountAt = <T extends LegacyLedgerAccount>(
    ctor: { prototype: T },
    index: number,
  ): T => {
    const account = Object.create(ctor.prototype) as T;
    (account as unknown as { accountIndex: number }).accountIndex = index;
    return account;
  };

  const legacyAt = (index: number) => accountAt(LegacyLedgerAccount, index);
  const nonLegacyAt = (index: number) => accountAt(LedgerAccount, index);

  // G5: LegacyLedgerAccount must stay bit-identical to main. These are the
  // exact numbers main emits — account = index + 0x80000000, addressType 0,
  // addressIndex 0 — for the indices #306's F7 fix made work.
  for (const index of [0, 1, 3]) {
    test(`legacy account ${index} signs from 44'/111111'/${index}'/0/0`, async () => {
      const tx = await signAndCapture(legacyAt(index));

      expect(tx.account).toBe(index + 0x80000000);
      expect(tx.changeAddressType).toBe(0);
      expect(tx.changeAddressIndex).toBe(0);
      expect(tx.inputs.map((i) => [i.addressType, i.addressIndex])).toEqual([
        [0, 0],
      ]);
    });
  }

  // B2: the fix. The device must derive from the address path, so the index
  // moves to the addressIndex position and account stays 0'.
  for (const index of [0, 1, 3]) {
    test(`non-legacy account ${index} signs from 44'/111111'/0'/0/${index}`, async () => {
      const tx = await signAndCapture(nonLegacyAt(index));

      expect(tx.account).toBe(0x80000000);
      expect(tx.changeAddressType).toBe(0);
      expect(tx.changeAddressIndex).toBe(index);
      expect(tx.inputs.map((i) => [i.addressType, i.addressIndex])).toEqual([
        [0, index],
      ]);
    });
  }

  // G6: the address path is what users see and what their funds are locked to.
  // These literals are what main derives for the same (class, index) pairs; any
  // change here would move an existing account's address.
  for (const index of [0, 1, 3]) {
    test(`address path is unchanged for both classes at index ${index}`, async () => {
      const legacy = legacyAt(index);
      const legacyStub = instrument(legacy);
      await legacy.getPublicKey();
      await legacy.getPublicKeys();

      const nonLegacy = nonLegacyAt(index);
      const nonLegacyStub = instrument(nonLegacy);
      await nonLegacy.getPublicKey();
      await nonLegacy.getPublicKeys();

      expect(legacyStub.paths).toEqual([
        `m/44'/111111'/${index}'/0/0`,
        `m/44'/111111'/${index}'/0/0`,
      ]);
      expect(nonLegacyStub.paths).toEqual([
        `m/44'/111111'/0'/0/${index}`,
        `m/44'/111111'/0'/0/${index}`,
      ]);
    });
  }

  // C: the derivation goes on every input, not just the first.
  test("every input carries the account's derivation, not a hardcoded 0/0", async () => {
    const tx = await signAndCapture(
      nonLegacyAt(3),
      mkTxJson({}, "90000000", 3),
    );

    expect(tx.inputs).toHaveLength(3);
    expect(tx.inputs.map((i) => [i.addressType, i.addressIndex])).toEqual([
      [0, 3],
      [0, 3],
      [0, 3],
    ]);
  });

  // signMessage reads the same accessor, so a message signed by a non-legacy
  // account at index >= 1 now verifies against the address it is shown under.
  test("signMessage uses the same derivation as the address path", async () => {
    const legacy = legacyAt(3);
    const legacyStub = instrument(legacy);
    await legacy.signMessage("hello");
    expect(legacyStub.messageArgs[0]).toEqual(["hello", 0, 0, 3 + 0x80000000]);

    const nonLegacy = nonLegacyAt(3);
    const nonLegacyStub = instrument(nonLegacy);
    await nonLegacy.signMessage("hello");
    expect(nonLegacyStub.messageArgs[0]).toEqual(["hello", 0, 3, 0x80000000]);
  });

  // D: hw-app-kaspa marshals sompi as a JS number, so anything the Number
  // domain cannot hold exactly must be refused rather than rounded.
  test("refuses input amounts above the safe-integer boundary", async () => {
    const account = nonLegacyAt(0);
    instrument(account);
    const tooBig = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();

    await expect(
      account.signTx(
        deserializeTransaction(
          mkTxJson({
            utxo: {
              address: null,
              amount: tooBig,
              scriptPublicKey: SPK,
              blockDaaScore: "1000",
              isCoinbase: false,
            },
          }),
        ),
      ),
    ).rejects.toThrow(/outside the range/);
  });

  test("refuses output amounts above the safe-integer boundary", async () => {
    const account = nonLegacyAt(0);
    instrument(account);
    const tooBig = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();

    await expect(
      account.signTx(deserializeTransaction(mkTxJson({}, tooBig))),
    ).rejects.toThrow(/outside the range/);
  });

  test("an amount at the safe-integer boundary still signs", async () => {
    const atMax = BigInt(Number.MAX_SAFE_INTEGER).toString();
    const tx = await signAndCapture(
      nonLegacyAt(0),
      mkTxJson({
        utxo: {
          address: null,
          amount: atMax,
          scriptPublicKey: SPK,
          blockDaaScore: "1000",
          isCoinbase: false,
        },
      }),
    );

    expect(tx.inputs[0].value).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("refuses an input with no UTXO entry instead of sending NaN", async () => {
    const account = nonLegacyAt(0);
    instrument(account);

    // The wasm deserializer will not accept a null utxo, so reach the same
    // state the way production does: an input whose UTXO entry was never
    // attached.
    const tx = deserializeTransaction(mkTxJson());
    tx.inputs = [
      {
        previousOutpoint: { transactionId: "11".repeat(32), index: 0 },
        signatureScript: "",
        sequence: 0n,
        sigOpCount: 1,
      },
    ];
    expect(tx.inputs[0].utxo).toBeUndefined();

    await expect(account.signTx(tx)).rejects.toThrow(/missing its UTXO entry/);
  });
});

// ---------------------------------------------------------------------------
// W1 — explicit lifetimes for secret-bearing WASM objects (wasm-lifecycle.ts).
// These objects are now freed at last use, which means a misplaced free shows
// up as "null pointer passed to rust" on the signing path. The derivation
// vectors below were captured from `main` BEFORE any free() was introduced and
// are hardcoded on purpose: comparing the two branches to each other would pass
// even if both were wrong, and at accountIndex 0 the two derivation paths
// coincide, so only indexes 1 and 3 can catch a branch swap.
// ---------------------------------------------------------------------------

const W1_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const W1_VECTORS = [
  {
    branch: "legacy",
    accountIndex: 0,
    address:
      "kaspa:qqd6e65yefepe9wk0m9vuxdufxd80sphy67gwwd0vdaumzdt4tc9s3qt0lqeh",
    firstPublicKey:
      "031bacea84ca721c95d67ecace19bc499a77c03726bc8739af637bcd89abaaf058",
  },
  {
    branch: "legacy",
    accountIndex: 1,
    address:
      "kaspa:qzyqe0y64jqvx043jd0mpgugrd00y39zp0t7j64854k7r0ln2eu3vck8n7p07",
    firstPublicKey:
      "03880cbc9aac80c33eb1935fb0a3881b5ef244a20bd7e96aa7a56de1bff3567916",
  },
  {
    branch: "legacy",
    accountIndex: 3,
    address:
      "kaspa:qrgg2k6l7r96x8ckw64rncttgsxs0zgdm2jsz20x4p4392ypjejsgx38gqhvj",
    firstPublicKey:
      "02d0855b5ff0cba31f1676aa39e16b440d07890ddaa50129e6a86b12a881966504",
  },
  {
    branch: "new",
    accountIndex: 0,
    address:
      "kaspa:qqd6e65yefepe9wk0m9vuxdufxd80sphy67gwwd0vdaumzdt4tc9s3qt0lqeh",
    firstPublicKey:
      "031bacea84ca721c95d67ecace19bc499a77c03726bc8739af637bcd89abaaf058",
  },
  {
    branch: "new",
    accountIndex: 1,
    address:
      "kaspa:qp6r0d88yj4fazlj057wc35245jfgs87n9jn6nahfg223996dfukvgpgq6pcp",
    firstPublicKey:
      "027437b4e724aa9e8bf27d3cec468aad249440fe99653d4fb74a14a894ba6a7966",
  },
  {
    branch: "new",
    accountIndex: 3,
    address:
      "kaspa:qqwn552u0tdqgcggarzeh2x5nh8lmkgzfg4nqay8vtl9pf975aw3ww9w4xy35",
    firstPublicKey:
      "021d3a515c7ada046108e8c59ba8d49dcffdd9024a2b30748762fe50a4bea75d17",
  },
] as const;

function w1Factory(branch: string) {
  return branch === "legacy"
    ? new LegacyAccountFactory()
    : new AccountFactory();
}

// a P2PK script paying the wallet's own derived key, so signTransaction can
// actually satisfy the input it is handed
function w1TxFor(xOnlyPublicKey: string) {
  const spk = "0000" + "20" + xOnlyPublicKey + "ac";

  return Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      id: "00".repeat(32),
      version: 0,
      inputs: [
        {
          transactionId: "11".repeat(32),
          index: 0,
          sequence: "0",
          sigOpCount: 1,
          computeBudget: 0,
          signatureScript: "",
          utxo: {
            address: null,
            amount: "100000000",
            scriptPublicKey: spk,
            blockDaaScore: "1000",
            isCoinbase: false,
          },
        },
      ],
      outputs: [{ value: "90000000", scriptPublicKey: spk }],
      lockTime: "0",
      subnetworkId: "00".repeat(20),
      gas: "0",
      payload: "",
    }),
  );
}

test.describe("WASM secret lifecycle (W1)", () => {
  for (const v of W1_VECTORS) {
    test(`${v.branch} branch derives unchanged addresses at index ${v.accountIndex}`, async () => {
      const wallet = w1Factory(v.branch).createFromMnemonic(
        W1_MNEMONIC,
        v.accountIndex,
      );

      expect((await wallet.getPublicKeys())[0]).toBe(v.firstPublicKey);
      expect(
        (await wallet.getPublicKey()).toAddress("mainnet").toString(),
      ).toBe(v.address);
    });

    test(`${v.branch} branch survives repeated use at index ${v.accountIndex}`, async () => {
      // a use-after-free surfaces as "null pointer passed to rust" on the
      // second iteration, so repetition is the cheap detector here
      const wallet = w1Factory(v.branch).createFromMnemonic(
        W1_MNEMONIC,
        v.accountIndex,
      );

      for (let i = 0; i < 20; i++) {
        expect((await wallet.getPublicKeys())[0]).toBe(v.firstPublicKey);
        expect(
          (await wallet.getPublicKey()).toAddress("mainnet").toString(),
        ).toBe(v.address);
        expect(await wallet.signMessage("kastle-w1")).toMatch(
          /^[0-9a-f]{128}$/,
        );
      }
    });
  }

  test("the two derivation branches stay distinct away from index 0", () => {
    // guards the isLegacy landmine itself: if the paths were ever swapped or
    // unified, these would collide
    const legacy = W1_VECTORS.filter((v) => v.branch === "legacy");
    const modern = W1_VECTORS.filter((v) => v.branch === "new");

    for (const index of [1, 3]) {
      const l = legacy.find((v) => v.accountIndex === index)!;
      const m = modern.find((v) => v.accountIndex === index)!;
      expect(l.address).not.toBe(m.address);
    }
  });

  for (const v of W1_VECTORS) {
    test(`${v.branch} branch still signs a transaction at index ${v.accountIndex}`, async () => {
      const wallet = w1Factory(v.branch).createFromMnemonic(
        W1_MNEMONIC,
        v.accountIndex,
      );
      const xOnly = (await wallet.getPublicKey()).toXOnlyPublicKey().toString();

      // repeated on purpose: the per-input PrivateKey in sign-script.ts is now
      // freed, so a use-after-free shows up on the second pass as
      // "null pointer passed to rust" rather than a wrong signature
      for (let i = 0; i < 5; i++) {
        const signed = await wallet.signTx(w1TxFor(xOnly), []);
        expect(signed.inputs[0].signatureScript).toBeTruthy();
      }
    });
  }

  test("free() really deallocates, so reuse throws rather than silently succeeding", () => {
    // documents the semantics every other test in this block relies on
    const key = new PrivateKey(TEST_KEY);
    expect(key.toString()).toBe(TEST_KEY);

    key.free();

    expect(() => key.toString()).toThrow();
  });

  test("withOwned frees what it owns even when the body throws", () => {
    let freed = false;
    const probe = {
      free() {
        freed = true;
      },
    };

    expect(() =>
      withOwned((own) => {
        own(probe);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(freed).toBe(true);
  });

  test("withOwned throws when the callback returns a thenable", () => {
    let freed = false;
    const probe = {
      free() {
        freed = true;
      },
    };

    expect(() =>
      withOwned((own) => {
        own(probe);
        return (async () => undefined)();
      }),
    ).toThrow(/synchronous-only/);
    // Must NOT be freed: the thrown error aborts withOwned(), but the async
    // callback is still suspended and may resume later. Freeing here would
    // be the exact use-after-free this guard exists to catch.
    expect(freed).toBe(false);
  });

  test("withOwned does not free an owned object out from under a still-running async callback", async () => {
    let freed = false;
    const probe = {
      free() {
        freed = true;
      },
    };
    let usedWhileStillUnfreed = false;
    let pending: Promise<void> | undefined;
    let sawError: unknown;

    try {
      withOwned((own) => {
        own(probe);
        pending = (async () => {
          await Promise.resolve();
          // If withOwned had freed `probe` synchronously (the old bug), this
          // would be a use-after-free in real wasm code.
          usedWhileStillUnfreed = !freed;
        })();
        return pending;
      });
    } catch (error) {
      sawError = error;
    }

    expect(sawError).toBeInstanceOf(Error);
    expect(freed).toBe(false);

    await pending;
    expect(usedWhileStillUnfreed).toBe(true);
    // withOwned() never frees on this path — the object leaks rather than
    // being corrupted out from under the still-suspended callback.
    expect(freed).toBe(false);
  });
});
