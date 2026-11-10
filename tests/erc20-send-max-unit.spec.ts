import { expect, test } from "@playwright/test";
import { decodeFunctionData, erc20Abi, formatUnits } from "viem";
import {
  erc20AmountFormatError,
  erc20MaxAmount,
  erc20TransferData,
} from "@/components/send/evm/erc20-send/transfer";
import { NOT_A_DECIMAL } from "@/lib/decimalAmount";

// QA issue 5: an ERC-20 balance of 2 base units at 8 decimals is the float
// 2e-8. Max wrote "2e-8" into the field; once a valid recipient was pasted the
// details step built the fee-estimate calldata with parseUnits("2e-8", 8) on
// render, which threw and unmounted the popup.

const RECIPIENT = "0x000000000000000000000000000000000000dEaD" as const;
const RAW = 2n;
const DECIMALS = 8;
const BALANCE = parseFloat(formatUnits(RAW, DECIMALS)); // 2e-8

const sentValue = (data: `0x${string}` | undefined) =>
  data === undefined
    ? undefined
    : String(decodeFunctionData({ abi: erc20Abi, data }).args?.[1]);

test("Max on a 2e-8 balance yields a plain decimal string", () => {
  expect(String(BALANCE)).toBe("2e-8");
  expect(erc20MaxAmount(RAW, BALANCE, DECIMALS)).toBe("0.00000002");
});

test("Max falls back to the float balance when rawBalance is the cache placeholder", () => {
  expect(erc20MaxAmount(0n, BALANCE, DECIMALS)).toBe("0.00000002");
  expect(erc20MaxAmount(0n, 1.5, 18)).toBe("1.5");
  expect(erc20MaxAmount(0n, 0, 18)).toBe("0");
});

test("the details-step calldata for the Max amount and a valid recipient does not throw", () => {
  const max = erc20MaxAmount(RAW, BALANCE, DECIMALS);
  let data: `0x${string}` | undefined;
  expect(() => {
    data = erc20TransferData(RECIPIENT, max, DECIMALS, RAW);
  }).not.toThrow();
  expect(sentValue(data)).toBe("2");
});

test("an exponent-form amount gives no calldata and a validation message, never a throw", () => {
  let data: `0x${string}` | undefined = "0x";
  expect(() => {
    data = erc20TransferData(RECIPIENT, "2e-8", DECIMALS, RAW);
  }).not.toThrow();
  expect(data).toBeUndefined();
  expect(erc20AmountFormatError("2e-8")).toBe(NOT_A_DECIMAL);
  expect(erc20AmountFormatError("abc")).toBe(NOT_A_DECIMAL);
});

test("valid amounts keep the existing calldata", () => {
  expect(erc20AmountFormatError("1.5")).toBeUndefined();
  expect(erc20AmountFormatError("")).toBeUndefined();
  expect(sentValue(erc20TransferData(RECIPIENT, "1.5", DECIMALS, RAW))).toBe(
    "150000000",
  );
  // Empty amount estimates against the whole raw balance, as before.
  expect(sentValue(erc20TransferData(RECIPIENT, "", DECIMALS, 7n))).toBe("7");
});
