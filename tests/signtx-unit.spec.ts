import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blake2b } from "@noble/hashes/blake2b";
import { schnorr } from "@noble/curves/secp256k1";
import init, {
  createInputSignature,
  PrivateKey,
  ScriptBuilder,
  SighashType,
  Transaction,
} from "@/wasm/core/kaspa";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  hasPartialOutputCommitment,
  normalizeScriptOptions,
  pushDataHex,
  signTxInputWithScriptOption,
  signTxWithScriptOptions,
  type RawScriptOption,
} from "@/lib/wallet/sign-script";
import { SIGN_TYPE, toSignType } from "@/lib/kaspa";
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
