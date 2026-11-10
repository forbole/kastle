import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  IUtxoEntry,
  PrivateKey,
  createTransactions,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { MAX_SEND_RESERVE_KAS } from "@/lib/kaspa";
import {
  findMaxSendable,
  isShortfall,
  orderEntries,
  planTransfer,
} from "@/lib/sendFee";
import { parseUnits } from "viem";
import {
  NOT_A_DECIMAL,
  formatMaxAmount,
  sanitizeDecimalInput,
  validateTokenAmount,
} from "@/lib/decimalAmount";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

const KEY_A =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
const KEY_B =
  "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";
const sender = () => new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
const dest = () =>
  new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet").toString();

const toEntries = (amounts: bigint[]) => {
  const address = sender();
  return amounts.map((amount, i) => ({
    address,
    outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(address),
    blockDaaScore: 1_000n,
    isCoinbase: false,
  })) as unknown as IUtxoEntry[];
};

// generator-errors-unit's wallet: 3005 KAS split evenly, remainder on the first.
const evenWallet = (count: number) => {
  const total = 300_500_000_000n;
  const each = total / BigInt(count);
  const amounts = Array.from({ length: count }, () => each);
  amounts[0] += total - each * BigInt(count);
  return toEntries(amounts);
};

const rebuild = (entries: IUtxoEntry[], amount: bigint, priorityFee: bigint) =>
  createTransactions({
    entries: orderEntries(entries),
    outputs: [{ address: dest(), amount }],
    priorityFee,
    changeAddress: sender().toString(),
    networkId: "mainnet",
  });

const max = (entries: IUtxoEntry[], priorityFee: bigint) =>
  findMaxSendable({
    entries,
    priorityFee,
    changeAddress: sender().toString(),
    networkId: "mainnet",
  });

test.describe("findMaxSendable", () => {
  test.setTimeout(120_000);

  test("11,449 UTXOs: ≥ 23,576 KAS in ≤ 3 builds, rebuilds at the same fee", async () => {
    const entries = toEntries([
      ...Array.from({ length: 11_446 }, () => 206_000_000n),
      412_000_000n,
      412_000_000n,
      300_000_000n,
    ]);
    const result = await max(entries, 0n);
    expect(result).toBeDefined();
    // the largest buildable amount, measured: 23,576.81583799 KAS
    expect(String(result!.amountSompi >= 2_357_679_583_799n)).toBe("true");
    expect(String(result!.amountSompi <= 2_357_681_583_799n)).toBe("true");
    expect(result!.builds).toBeLessThanOrEqual(3);

    const { summary } = await rebuild(entries, result!.amountSompi, 0n);
    expect(String(summary.fees)).toBe(String(result!.fee));

    // the send path itself accepts the Max amount
    const plan = await planTransfer({
      entries,
      amountSompi: result!.amountSompi,
      outputAddress: dest(),
      changeAddress: sender().toString(),
      priorityFee: 0n,
      networkId: "mainnet",
    });
    expect(isShortfall(plan)).toBe(false);
  });

  for (const priorityFee of [0n, 2_838_600n]) {
    test(`174/175 UTXO cliffs build at priorityFee ${priorityFee}`, async () => {
      for (const count of [174, 175]) {
        const entries = evenWallet(count);
        const result = await max(entries, priorityFee);
        expect(result, `${count}`).toBeDefined();
        const { transactions } = await rebuild(
          entries,
          result!.amountSompi,
          priorityFee,
        );
        expect(transactions.length).toBeGreaterThan(0);
        if (count === 174) {
          // the old Max (balance − 0.3 KAS − priorityFee) built here; the new
          // one keeps a 0.11 KAS change margin, so it may sit up to 0.02 below
          const oldMax =
            300_500_000_000n -
            BigInt(Math.round(MAX_SEND_RESERVE_KAS * 1e8)) -
            priorityFee;
          expect(String(result!.amountSompi >= oldMax - 2_000_000n)).toBe(
            "true",
          );
        }
      }
    });
  }

  test("1, 100 and 270 UTXOs build", async () => {
    for (const count of [1, 100, 270]) {
      const entries = evenWallet(count);
      const result = await max(entries, 0n);
      expect(result, `${count}`).toBeDefined();
      const { transactions } = await rebuild(entries, result!.amountSompi, 0n);
      expect(transactions.length).toBeGreaterThan(0);
    }
  });
});

// QA 5: Max on a tiny balance, then a pasted recipient, crashed the popup with
// viem's "Number `2e-8` is not a valid decimal number". The amount must stay a
// plain decimal string, and no validator may throw on what the user typed.
test.describe("token amount: plain decimal string, validator never throws", () => {
  const NACHO = { decimals: 8, symbol: "NACHO" };

  test("Max of 2 base units at 8 decimals is exactly 0.00000002", () => {
    const max = formatMaxAmount(2n, 8);
    expect(max).toBe("0.00000002");
    // the float the old number input handed the form
    expect(String(Number(max))).toBe("2e-8");
    expect(validateTokenAmount(max, { ...NACHO, spendable: 2n })).toBe(true);
    expect(validateTokenAmount(max, { ...NACHO, spendable: 1n })).toBe(
      "Oh, you don’t have enough funds",
    );
  });

  test("a 0-decimal token: Max is an integer, a fraction is refused", () => {
    expect(formatMaxAmount(5n, 0)).toBe("5");
    expect(formatMaxAmount("12345678901234567890", 0)).toBe(
      "12345678901234567890",
    );
    const zeroDec = { decimals: 0, symbol: "WHOLE", spendable: 5n };
    expect(validateTokenAmount("5", zeroDec)).toBe(true);
    expect(validateTokenAmount("0.5", zeroDec)).toBe(
      "WHOLE has no decimal places",
    );
    expect(sanitizeDecimalInput("3.7", 0)).toBe("3");
  });

  test("Max never rounds, pads or uses exponent notation", () => {
    expect(formatMaxAmount(1_000_000_000n, 8)).toBe("10");
    expect(formatMaxAmount(123_456_789_012n, 11)).toBe("1.23456789012");
    expect(formatMaxAmount(10n ** 30n, 8)).toBe("10000000000000000000000");
    expect(formatMaxAmount(0n, 8)).toBe("0");
    expect(formatMaxAmount(undefined, 8)).toBe("0");
    expect(formatMaxAmount("not-a-number", 8)).toBe("0");
  });

  test("an exponent-form amount returns a message instead of throwing", () => {
    // what threw: viem refuses exponent notation
    expect(() => parseUnits("2e-8", 8)).toThrow(/not a valid decimal number/);
    for (const input of ["2e-8", "1e3", "-1", "1.2.3", "abc", "1,5"]) {
      expect(
        validateTokenAmount(input, { ...NACHO, spendable: 10n ** 18n }),
        input,
      ).toBe(NOT_A_DECIMAL);
    }
    // the clamp leaves non-decimal text alone so the validator can say so
    expect(sanitizeDecimalInput("2e-8", 8)).toBe("2e-8");
  });

  test("empty, zero or a lone point keeps Next disabled without a message", () => {
    for (const input of [undefined, "", " ", ".", "0", "0.000"]) {
      expect(
        validateTokenAmount(input, { ...NACHO, spendable: 10n }),
        String(input),
      ).toBe("");
    }
  });

  test("the input clamp keeps at most `decimals` fraction digits", () => {
    expect(sanitizeDecimalInput("0.123456789", 8)).toBe("0.12345678");
    expect(sanitizeDecimalInput("12.", 8)).toBe("12.");
    expect(sanitizeDecimalInput(".5", 8)).toBe(".5");
  });
});
