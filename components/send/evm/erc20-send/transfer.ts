import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  encodeFunctionData,
  erc20Abi,
} from "viem";
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

export const ERC20_EXCEEDS_BALANCE = "Transfer amount exceeds balance.";

// Whether the typed amount is more than the holder has. Exact against the raw
// balance; the cached-balance fallback carries rawBalance 0n, so then the
// float compare is all we have and a valid amount must not be rejected. An
// amount the parser rejects (too many decimals, ".5") also falls back to the
// float compare, so an over-balance one stays blocked as it was before.
export function erc20ExceedsBalance(
  value: string,
  decimals: number,
  rawBalance: bigint,
  balance: number,
): boolean {
  const amount =
    rawBalance > 0n ? parseDecimalUnits(value, decimals) : undefined;
  return amount !== undefined
    ? amount > rawBalance
    : parseFloat(value) > balance;
}

// The token's own "Transfer amount exceeds balance" revert: a user condition,
// not a wallet fault. Every other revert and error returns false.
export function isErc20ExceedsBalanceRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const revert = error.walk(
    (e) =>
      e instanceof ContractFunctionRevertedError ||
      e instanceof ExecutionRevertedError,
  );
  if (revert instanceof ContractFunctionRevertedError)
    return revert.reason === "Transfer amount exceeds balance";
  if (revert instanceof ExecutionRevertedError)
    return (
      revert.shortMessage ===
      "Execution reverted with reason: Transfer amount exceeds balance."
    );
  return false;
}
