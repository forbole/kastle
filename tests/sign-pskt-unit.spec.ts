import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import init, { PrivateKey, Transaction } from "@/wasm/core/kaspa";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  psktSignOptions,
  psktSignSummary,
  signTxInputWithScriptOption,
  signTxWithScriptOptions,
  toPsktSignType,
} from "@/lib/wallet/sign-script";
import { SignPsktPayloadSchema } from "@/api/background/handlers/kaspa/utils";

// Throwaway key — unit tests only, never funded.
const TEST_KEY =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
const OTHER_KEY = "11".repeat(32);

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

const xOnly = (key: string) =>
  new PrivateKey(key).toPublicKey().toXOnlyPublicKey().toString();
const addressOf = (key: string) =>
  new PrivateKey(key).toPublicKey().toAddress("testnet-10").toString();
const WALLET = () => addressOf(TEST_KEY);

const P2PK = (key: string) => "0000" + "20" + xOnly(key) + "ac";
const P2SH = "0000" + "aa20" + "ab".repeat(32) + "87";

// One input per scriptPublicKey given, two outputs back to TEST_KEY.
function mkTx(spks: string[], signatureScripts: string[] = []) {
  return Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      id: "00".repeat(32),
      version: 0,
      inputs: spks.map((spk, i) => ({
        transactionId: (i + 1).toString(16).padStart(2, "0").repeat(32),
        index: 0,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: signatureScripts[i] ?? "",
        utxo: {
          address: null,
          amount: "100000000",
          scriptPublicKey: spk,
          blockDaaScore: "1000",
          isCoinbase: false,
        },
      })),
      outputs: [0, 1].map(() => ({
        value: "45000000",
        scriptPublicKey: P2PK(TEST_KEY),
      })),
      lockTime: "0",
      subnetworkId: "00".repeat(20),
      gas: "0",
      payload: "",
    }),
  );
}

const sigScripts = (tx: Transaction): string[] =>
  JSON.parse(tx.serializeToSafeJSON()).inputs.map(
    (input: { signatureScript: string }) => input.signatureScript,
  );

test.describe("toPsktSignType", () => {
  test("maps 1 to All and 129 to AllAnyOneCanPay; omitted is All", () => {
    expect(toPsktSignType(1)).toBe("All");
    expect(toPsktSignType(129)).toBe("AllAnyOneCanPay");
    expect(toPsktSignType(undefined)).toBe("All");
  });

  test("refuses every other value, naming it and the accepted set", () => {
    const accepted = "accepted: 1 (All), 129 (AllAnyOneCanPay)";
    const refused: [unknown, string][] = [
      [2, "2"], // None
      [130, "130"], // NoneAnyOneCanPay
      [4, "4"], // Single
      [132, "132"], // SingleAnyOneCanPay
      [0, "0"],
      [1.5, "1.5"],
      [NaN, "NaN"],
      [-1, "-1"],
      ["1", '"1"'],
      [null, "null"],
      [true, "true"],
    ];
    for (const [value, named] of refused) {
      expect(() => toPsktSignType(value)).toThrow(
        `signPskt: sighashType ${named} is not accepted; ${accepted}`,
      );
    }
  });
});

test.describe("psktSignOptions", () => {
  test("maps index to inputIndex, with the mapped sighash type", () => {
    const tx = mkTx([P2SH, P2SH]);
    expect(
      psktSignOptions(
        tx,
        [{ index: 1, sighashType: 129 }, { index: 0 }],
        WALLET(),
      ),
    ).toEqual([
      { inputIndex: 1, signType: "AllAnyOneCanPay" },
      { inputIndex: 0, signType: "All" },
    ]);
  });

  test("a listed P2SH index gets 41||sig||01 while a second input's signatureScript stays empty", () => {
    // Per input: signing the listed index touches no other input. (End to
    // end a second "" input cannot survive: it is listed, the wallet's own
    // and signed by the fallback, or refused as a hole.)
    const tx = mkTx([P2SH, P2SH]);
    const [first] = psktSignOptions(
      tx,
      [{ index: 0, sighashType: 1 }, { index: 1 }],
      WALLET(),
    );
    signTxInputWithScriptOption(tx, first, TEST_KEY);
    const [p2sh, second] = sigScripts(tx);
    expect(p2sh).toMatch(/^41[0-9a-f]{128}01$/);
    expect(second).toBe("");
  });

  test("an unlisted, pre-filled foreign input is not a hole and passes through untouched", async () => {
    const prefilled = "51";
    const tx = mkTx([P2SH, P2PK(OTHER_KEY)], ["", prefilled]);
    const scripts = psktSignOptions(tx, [{ index: 0 }], WALLET());
    const signed = await signTxWithScriptOptions(tx, scripts, TEST_KEY);
    const [p2sh, other] = sigScripts(signed);
    expect(p2sh).toMatch(/^41[0-9a-f]{128}01$/);
    expect(other).toBe(prefilled);
  });

  test("the wallet's own coin needs no listing; a foreign one does, and the refusal lists every hole", () => {
    const own = P2PK(TEST_KEY);
    expect(
      psktSignOptions(mkTx([own, P2SH]), [{ index: 1 }], WALLET()),
    ).toEqual([{ inputIndex: 1, signType: "All" }]);
    expect(() =>
      psktSignOptions(
        mkTx([P2SH, own, P2SH, P2PK(OTHER_KEY)]),
        [{ index: 0 }],
        WALLET(),
      ),
    ).toThrow(
      "signPskt: inputs 2, 3 would be left unsigned: not listed in signInputs and not your own coin",
    );
    expect(() => psktSignOptions(mkTx([own, P2SH]), [], WALLET())).toThrow(
      "signPskt: input 1 would be left unsigned",
    );
  });

  test("signInputs omitted signs the wallet's own inputs with All, and still refuses a foreign one", async () => {
    const own = P2PK(TEST_KEY);
    const tx = mkTx([own, own]);
    const scripts = psktSignOptions(tx, undefined, WALLET());
    expect(scripts).toEqual([]);
    const signed = await signTxWithScriptOptions(tx, scripts, TEST_KEY);
    for (const s of sigScripts(signed))
      expect(s).toMatch(/^41[0-9a-f]{128}01$/);

    expect(() =>
      psktSignOptions(mkTx([own, P2SH]), undefined, WALLET()),
    ).toThrow("signPskt: input 1 would be left unsigned");
  });

  test("refuses a duplicate index", () => {
    expect(() =>
      psktSignOptions(
        mkTx([P2SH, P2SH]),
        [{ index: 0 }, { index: 1 }, { index: 0, sighashType: 129 }],
        WALLET(),
      ),
    ).toThrow("signPskt: input 0 is listed twice");
  });

  test("refuses an out-of-range index", () => {
    expect(() =>
      psktSignOptions(mkTx([P2SH, P2SH]), [{ index: 2 }], WALLET()),
    ).toThrow("signPskt: input 2 does not exist (2 inputs)");
  });

  test("refuses a bad sighashType before anything is signed", () => {
    const tx = mkTx([P2SH]);
    expect(() =>
      psktSignOptions(tx, [{ index: 0, sighashType: 4 }], WALLET()),
    ).toThrow("signPskt: sighashType 4 is not accepted");
    expect(sigScripts(tx)).toEqual([""]);
  });

  test("skips null and hole entries in a sparse signInputs array", () => {
    const sparse: ({ index: number } | null | undefined)[] = [];
    sparse[1] = { index: 1 };
    sparse[3] = null;
    sparse[4] = { index: 0 };
    expect(psktSignOptions(mkTx([P2SH, P2SH]), sparse, WALLET())).toEqual([
      { inputIndex: 1, signType: "All" },
      { inputIndex: 0, signType: "All" },
    ]);
  });
});

test.describe("SignPsktPayloadSchema", () => {
  const txJsonString = () => mkTx([P2SH]).serializeToSafeJSON();

  test("accepts Kasware's call shape, with and without options", () => {
    const json = txJsonString();
    expect(SignPsktPayloadSchema.parse({ txJsonString: json })).toEqual({
      txJsonString: json,
    });
    expect(
      SignPsktPayloadSchema.parse({
        txJsonString: json,
        options: { signInputs: [{ index: 0, sighashType: 1 }] },
      }).options?.signInputs,
    ).toEqual([{ index: 0, sighashType: 1 }]);
  });

  test("strips unknown extra fields at every level", () => {
    const parsed = SignPsktPayloadSchema.parse({
      txJsonString: txJsonString(),
      extra: 1,
      options: {
        autoFinalized: false,
        signInputs: [{ index: 0, sighashType: 1, address: "kaspa:x" }],
      },
    });
    expect(Object.keys(parsed)).toEqual(["txJsonString", "options"]);
    expect(Object.keys(parsed.options!)).toEqual(["signInputs"]);
    expect(parsed.options!.signInputs).toEqual([{ index: 0, sighashType: 1 }]);
  });

  test("refuses a txJsonString that is not JSON, or missing", () => {
    for (const payload of [
      { txJsonString: "not json" },
      { txJsonString: "{" },
      { txJsonString: 42 },
      {},
      null,
      "not an object",
    ]) {
      expect(SignPsktPayloadSchema.safeParse(payload).success).toBe(false);
    }
  });

  test("refuses a malformed index; leaves sighashType to toPsktSignType", () => {
    for (const index of [-1, 1.5, "0", null, undefined]) {
      expect(
        SignPsktPayloadSchema.safeParse({
          txJsonString: txJsonString(),
          options: { signInputs: [{ index }] },
        }).success,
      ).toBe(false);
    }
    // a bad sighashType passes the schema so its refusal can name it
    expect(
      SignPsktPayloadSchema.safeParse({
        txJsonString: txJsonString(),
        options: { signInputs: [{ index: 0, sighashType: "x" }] },
      }).success,
    ).toBe(true);
  });

  test("keeps a sparse signInputs array parseable", () => {
    const sparse: unknown[] = [];
    sparse[1] = { index: 0 };
    sparse[2] = null;
    const parsed = SignPsktPayloadSchema.parse({
      txJsonString: txJsonString(),
      options: { signInputs: sparse },
    });
    expect(parsed.options!.signInputs!.filter((o) => o != null)).toEqual([
      { index: 0 },
    ]);
  });
});

test.describe("signPskt leaves the rest of the transaction alone", () => {
  // The kaspa.com covenant fixture: v1, covenant outputs, covenantId on
  // every utxo, input 0 pre-filled, input 1 a P2SH the dApp asks us to sign,
  // input 2 a plain P2PK coin.
  const raw = fs.readFileSync(
    path.join(TESTS_DIR, "../test/fixtures/kaspacom-signtx-repro.txt"),
    "utf8",
  );
  const fixture = () => {
    const tx = JSON.parse(raw.match(/signTx\(\s*'[^']+',\s*'(.*?)',/s)![1]);
    // the fixture's is "0": a non-zero value proves the value survives
    tx.storageMass = "123456";
    return tx;
  };

  test("safe JSON in, signed safe JSON out: mass, utxo entries and covenant fields byte for byte", async () => {
    const original = fixture();
    const txJsonString = JSON.stringify(original);
    const tx = deserializeTransaction(txJsonString);
    const scripts = psktSignOptions(
      tx,
      // input 2 is the buyer's coin under another key than TEST_KEY: it
      // must be listed, or it is a hole (asserted below)
      [{ index: 1, sighashType: 1 }, { index: 2 }],
      WALLET(),
    );
    const signed = await signTxWithScriptOptions(tx, scripts, TEST_KEY);
    const result = JSON.parse(signed.serializeToSafeJSON());

    expect(result.storageMass).toBe(original.storageMass);
    for (const field of [
      "version",
      "lockTime",
      "gas",
      "subnetworkId",
      "payload",
    ])
      expect(result[field]).toBe(original[field]);
    expect(JSON.stringify(result.outputs)).toBe(
      JSON.stringify(original.outputs),
    );
    expect(result.inputs.length).toBe(original.inputs.length);
    result.inputs.forEach((input: any, i: number) => {
      const before = original.inputs[i];
      expect(JSON.stringify(input.utxo)).toBe(JSON.stringify(before.utxo));
      for (const field of [
        "transactionId",
        "index",
        "sequence",
        "sigOpCount",
        "computeBudget",
      ])
        expect(input[field]).toBe(before[field]);
    });
    // covenant binding fields, explicitly
    expect(result.outputs.map((o: any) => o.covenant ?? null)).toEqual(
      original.outputs.map((o: any) => o.covenant ?? null),
    );
    expect(result.inputs.map((i: any) => i.utxo.covenantId)).toEqual(
      original.inputs.map((i: any) => i.utxo.covenantId),
    );

    // only the listed input changed: the pre-filled one is untouched
    expect(result.inputs[0].signatureScript).toBe(
      original.inputs[0].signatureScript,
    );
    expect(original.inputs[1].signatureScript).toBe("");
    expect(result.inputs[1].signatureScript).toMatch(/^41[0-9a-f]{128}01$/);
    expect(result.inputs[2].signatureScript).toMatch(/^41[0-9a-f]{128}01$/);
    expect(() =>
      psktSignOptions(
        deserializeTransaction(txJsonString),
        [{ index: 1 }],
        WALLET(),
      ),
    ).toThrow("signPskt: input 2 would be left unsigned");
  });

  test("a legacy `mass` key keeps its value (the WASM reads it as storageMass)", () => {
    // `mass` is the deprecated alias of storageMass (wasm/core/kaspa.d.ts):
    // the value survives, under the current key.
    const { storageMass, ...rest } = fixture();
    const result = JSON.parse(
      deserializeTransaction(
        JSON.stringify({ ...rest, mass: storageMass }),
      ).serializeToSafeJSON(),
    );
    expect(result.storageMass).toBe(storageMass);
  });
});

test.describe("psktSignSummary (the confirm screen's count)", () => {
  test("a listed foreign input beside an unlisted own coin: 2 signed, 1 not your own", () => {
    const tx = mkTx([P2SH, P2PK(TEST_KEY)]);
    const scripts = psktSignOptions(tx, [{ index: 0 }], WALLET());
    expect(psktSignSummary(tx, scripts, WALLET())).toEqual({
      signed: 2,
      foreign: 1,
    });
  });

  test("listed inputs that complete the tx: the own-coin fallback signs nothing more", () => {
    // Input 1 is an own coin already carrying a signature: nothing re-signs it.
    const tx = mkTx([P2SH, P2PK(TEST_KEY)], ["", "51"]);
    expect(
      psktSignSummary(tx, [{ inputIndex: 0, signType: "All" }], WALLET()),
    ).toEqual({ signed: 1, foreign: 1 });
  });

  test("no signInputs: every own coin, none foreign", () => {
    const tx = mkTx([P2PK(TEST_KEY), P2PK(TEST_KEY)]);
    expect(psktSignSummary(tx, [], WALLET())).toEqual({
      signed: 2,
      foreign: 0,
    });
  });

  test("an input without its UTXO entry: not computable, never 0", () => {
    const tx = new Transaction({
      version: 0,
      inputs: [
        {
          previousOutpoint: { transactionId: "01".repeat(32), index: 0 },
          signatureScript: "",
          sequence: 0n,
          sigOpCount: 1,
        },
      ],
      outputs: [],
      lockTime: 0n,
      subnetworkId: "00".repeat(20),
      gas: 0n,
      payload: "",
    } as any);
    expect(tx.inputs[0].utxo).toBeUndefined();
    expect(
      psktSignSummary(tx, [{ inputIndex: 0, signType: "All" }], WALLET()),
    ).toBeUndefined();
  });
});
