import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { applyDecimal } from "@/lib/krc20";
import {
  decimalsError,
  formatMaxAmount,
  krc20Decimals,
  sanitizeDecimalInput,
  validateKrc20Amount,
} from "@/lib/decimalAmount";

// The KRC-20 send form cuts Max and clamps input at krc20Decimals(dec);
// Krc20Transfer turns the amount into base units with applyDecimal(dec).
// Both must use the token's own dec, or Max sends a different amount.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

for (const [dec, balance] of [
  ["0", "12345"],
  ["2", "12345"],
  ["8", "123456789"],
  ["8", "1"],
  ["4", "99990001"],
] as const) {
  test(`Max at dec ${dec} converts back to the raw balance ${balance}`, () => {
    const max = formatMaxAmount(balance, krc20Decimals(dec));
    const { toInteger } = applyDecimal(dec);
    expect(String(Math.round(toInteger(parseFloat(max))))).toBe(balance);
  });
}

test("a fixed 8 would mis-scale a non-8 token (the drift this pins)", () => {
  const max = formatMaxAmount("12345", 8);
  expect(String(applyDecimal("2").toInteger(parseFloat(max)))).not.toBe(
    "12345",
  );
});

test("krc20Decimals matches applyDecimal's default of 8", () => {
  expect(krc20Decimals(undefined)).toBe(8);
  expect(krc20Decimals("x")).toBe(8);
  expect(krc20Decimals("1.5")).toBe(8);
  expect(krc20Decimals("0")).toBe(0);
  expect(applyDecimal(undefined).toInteger(1)).toBe(1e8);
});

test("a blank or missing dec falls back to 8 on both sides", () => {
  for (const dec of ["", "   ", undefined]) {
    expect(krc20Decimals(dec)).toBe(8);
    expect(applyDecimal(dec).toInteger(1)).toBe(1e8);
    const max = formatMaxAmount("123456789", krc20Decimals(dec));
    expect(max).toBe("1.23456789");
    expect(
      String(Math.round(applyDecimal(dec).toInteger(parseFloat(max)))),
    ).toBe("123456789");
  }
});

test("form and transfer both read the token's own dec", () => {
  expect(src("components/send/krc20-send/DetailsStep.tsx")).toContain(
    "krc20Decimals(tokenBalance?.dec)",
  );
  expect(src("components/send/krc20-send/Krc20Transfer.tsx")).toContain(
    "applyDecimal(tokenInfoResponse?.result?.[0].dec)",
  );
});

// Copilot #437: a malformed dec must resolve to ONE scale on both sides, or
// Krc20Transfer converts the Max string at a different scale than the form.
test("a malformed dec resolves to the same scale on both sides", () => {
  for (const dec of ["1.5", "-1", "abc", "", "   ", "0x10", "1e1"]) {
    const scale = krc20Decimals(dec);
    expect(scale, dec).toBe(8);
    expect(applyDecimal(dec).toInteger(1), dec).toBe(10 ** scale);
  }
  for (const dec of ["1.5", "-1"]) {
    const max = formatMaxAmount("123456789", krc20Decimals(dec));
    expect(max).toBe("1.23456789");
    expect(
      String(Math.round(applyDecimal(dec).toInteger(parseFloat(max)))),
    ).toBe("123456789");
  }
});

// Copilot #437: the clamp and the validator must see one normalized string.
test("surrounding whitespace cannot smuggle excess precision past the clamp", () => {
  for (const typed of ["0.000000001 ", " 0.000000001"]) {
    expect(sanitizeDecimalInput(typed, 8)).toBe("0.00000000");
    expect(
      validateKrc20Amount(typed, {
        decimals: 8,
        symbol: "KASPY",
        balance: "100000000000",
      }),
    ).toBe(decimalsError("0.000000001", 8, "KASPY"));
  }
  expect(sanitizeDecimalInput(" 1.5 ", 8)).toBe("1.5");
});

// Copilot #437: a float compare rejected an exact Max past 2^53.
test("Max of a balance past 2^53 validates against the raw balance", () => {
  const balance = "9007199254740993";
  const max = formatMaxAmount(balance, 8);
  expect(max).toBe("90071992.54740993");
  const opts = { decimals: 8, symbol: "KASPY", balance };
  expect(validateKrc20Amount(max, opts)).toBe(true);
  expect(validateKrc20Amount("90071992.54740994", opts)).toBe(
    "Oh, you don’t have enough funds",
  );
  expect(validateKrc20Amount("1", { ...opts, balance: undefined })).toBe(
    "Oh, you don’t have enough funds",
  );
});
