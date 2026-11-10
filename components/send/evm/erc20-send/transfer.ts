import { encodeFunctionData, erc20Abi } from "viem";
import {
  NOT_A_DECIMAL,
  formatFloatAmount,
  formatMaxAmount,
  isPlainDecimal,
  parseDecimalUnits,
} from "@/lib/decimalAmount";

// Calldata for `transfer(recipient, amount)`, built while rendering the send
// screens to estimate gas. An empty amount estimates against the whole raw
// balance; an amount that is not a plain decimal ("2e-8") yields undefined so
// the fee estimate is simply absent. Never throws.
export function erc20TransferData(
  recipient: `0x${string}`,
  amount: string | undefined,
  decimals: number,
  rawBalance: bigint | undefined,
): `0x${string}` | undefined {
  const value = amount
    ? parseDecimalUnits(amount, decimals)
    : (rawBalance ?? 0n);
  if (value === undefined) return undefined;
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, value],
  });
}

// What Max fills in: the exact raw balance at the token's decimals. The
// cached-balance fallback carries rawBalance 0n, so then the float is used.
export function erc20MaxAmount(
  rawBalance: bigint | undefined,
  balance: number | undefined,
  decimals: number,
): string {
  const exact = formatMaxAmount(rawBalance, decimals);
  return exact !== "0" ? exact : formatFloatAmount(balance ?? 0, decimals);
}

export function erc20AmountFormatError(value: string | undefined) {
  return isPlainDecimal(value) ? undefined : NOT_A_DECIMAL;
}
