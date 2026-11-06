import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { schnorrSighash, transactionId } from "@dotk/sdk-tx";
import { l1 } from "@braid_swap/sdk";
import { bytesToHex } from "@noble/hashes/utils";
import {
  BraidTxFormatError,
  braidTxId,
  braidWalletJsonToTx,
} from "@/lib/braid/adapter";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
// SYNTHETIC: serialized by the SDK's own l1.walletJson, not a server build.
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(TESTS_DIR, "fixtures/braid/deposit.synthetic.json"),
    "utf8",
  ),
) as {
  xOnlyPk: string;
  walletJson: string;
  braidSighashes: Record<string, string>;
};

type Raw = any;

const mutate = (edit: (t: Raw) => void) => {
  const t = JSON.parse(fixture.walletJson);
  edit(t);
  return JSON.stringify(t);
};

test.describe("braidWalletJsonToTx", () => {
  test("parses the deposit into a Tx", () => {
    const me = `20${fixture.xOnlyPk}ac`;
    const router = `aa20${"cd".repeat(32)}87`;
    const tx = braidWalletJsonToTx(fixture.walletJson);

    expect(tx).toEqual({
      version: 1,
      lockTime: 0n,
      subnetworkId: "00".repeat(20),
      gas: 0n,
      payload: "",
      inputs: [
        {
          previousOutpoint: { transactionId: "01".repeat(32), index: 0 },
          signatureScript: "",
          sequence: 0n,
          computeBudget: 0,
          utxo: {
            amount: 150_000_000n,
            scriptPublicKey: me,
            scriptVersion: 0,
            blockDaaScore: 9_000_001n,
            isCoinbase: false,
          },
        },
        {
          previousOutpoint: { transactionId: "02".repeat(32), index: 3 },
          signatureScript: "",
          sequence: 0n,
          computeBudget: 0,
          utxo: {
            amount: 2_500_000_000n,
            scriptPublicKey: me,
            scriptVersion: 0,
            blockDaaScore: 9_000_002n,
            isCoinbase: false,
          },
        },
        {
          previousOutpoint: { transactionId: "03".repeat(32), index: 1 },
          signatureScript: "51",
          sequence: 0n,
          computeBudget: 0,
          utxo: {
            amount: 100_000_000n,
            scriptPublicKey: router,
            scriptVersion: 0,
            blockDaaScore: 9_000_003n,
            isCoinbase: false,
          },
        },
      ],
      outputs: [
        {
          value: 1_200_000_000n,
          scriptPublicKey: router,
          scriptVersion: 0,
          covenant: { authorizingInput: 2, covenantId: "ef".repeat(32) },
        },
        { value: 1_449_000_000n, scriptPublicKey: me, scriptVersion: 0 },
      ],
    });
  });

  test("gives the same v1 sighash as the Braid SDK for every input", () => {
    const tx = braidWalletJsonToTx(fixture.walletJson);
    const braid = l1.parseTx(JSON.parse(fixture.walletJson));
    tx.inputs.forEach((_, i) => {
      const ours = bytesToHex(schnorrSighash(tx, i));
      expect(ours).toBe(bytesToHex(l1.sighash(braid, i)));
      expect(ours).toBe(fixture.braidSighashes[String(i)]);
    });
  });

  test("reads a script version from the first two bytes", () => {
    const tx = braidWalletJsonToTx(
      mutate((t) => (t.outputs[1].scriptPublicKey = `0002${"ab".repeat(4)}`)),
    );
    expect(tx.outputs[1]).toMatchObject({
      scriptVersion: 2,
      scriptPublicKey: "ab".repeat(4),
    });
  });

  for (const [what, edit, message] of [
    [
      "transaction",
      (t: Raw) => (t.storageMass = "0"),
      "transaction carries an unknown field storageMass",
    ],
    [
      "input",
      (t: Raw) => (t.inputs[0].computeBudget = 0),
      "input 0 carries an unknown field computeBudget",
    ],
    [
      "coin",
      (t: Raw) => (t.inputs[0].utxo.covenantId = null),
      "input 0 coin carries an unknown field covenantId",
    ],
    [
      "output",
      (t: Raw) => (t.outputs[0].extra = 1),
      "output 0 carries an unknown field extra",
    ],
    [
      "covenant",
      (t: Raw) => (t.outputs[0].covenant.note = "x"),
      "output 0 covenant carries an unknown field note",
    ],
  ] as const) {
    test(`refuses an unknown ${what} field`, () => {
      expect(() => braidWalletJsonToTx(mutate(edit))).toThrow(
        new BraidTxFormatError(message),
      );
    });
  }

  for (const [what, amount, message] of [
    ["a number", 150000000, "bad input 0 amount"],
    ["a decimal point", "1.5", "bad input 0 amount"],
    ["a leading zero", "0150000000", "bad input 0 amount"],
    ["a sign", "-1", "bad input 0 amount"],
    ["hex", "0x10", "bad input 0 amount"],
    ["more than u64", "18446744073709551616", "input 0 amount out of range"],
  ] as const) {
    test(`refuses an amount given as ${what}`, () => {
      const run = () =>
        braidWalletJsonToTx(mutate((t) => (t.inputs[0].utxo.amount = amount)));
      expect(run).toThrow(BraidTxFormatError);
      expect(run).toThrow(`Braid transaction refused: ${message}`);
    });
  }

  test("refuses a malformed output value, lockTime and gas", () => {
    for (const [edit, message] of [
      [(t: Raw) => (t.outputs[0].value = "12e8"), "bad output 0 value"],
      [(t: Raw) => (t.lockTime = 0), "bad lockTime"],
      [(t: Raw) => (t.gas = ""), "bad gas"],
    ] as const) {
      expect(() => braidWalletJsonToTx(mutate(edit))).toThrow(
        new BraidTxFormatError(message),
      );
    }
  });

  test("refuses a covenant pointing past the inputs", () => {
    expect(() =>
      braidWalletJsonToTx(
        mutate((t) => (t.outputs[0].covenant.authorizingInput = 3)),
      ),
    ).toThrow(new BraidTxFormatError("bad output 0 authorizingInput"));
  });

  test("refuses non-JSON", () => {
    expect(() => braidWalletJsonToTx("{")).toThrow(
      new BraidTxFormatError("not JSON"),
    );
  });
});

test.describe("braidTxId", () => {
  test("is the @dotk/sdk-tx transaction id", () => {
    const tx = braidWalletJsonToTx(fixture.walletJson);
    expect(braidTxId(tx)).toBe(transactionId(tx));
    expect(braidTxId(tx)).toMatch(/^[0-9a-f]{64}$/);
  });
});
