import { formatUnits, parseUnits } from "viem";

// A token amount is a decimal quantity carried as a string end to end. A float
// cannot hold it: 2 base units at 8 decimals is the Number 2e-8, whose string
// form "2e-8" viem's parseUnits rejects with a throw.

const PLAIN_DECIMAL = /^\d*\.?\d*$/;

export const NOT_A_DECIMAL = "Enter the amount as a plain number, like 0.5";
const NOT_ENOUGH_FUNDS = "Oh, you don’t have enough funds";

// parseUnits rounds excess decimals: "0.6" of a 0-decimal token would send 1.
export function decimalsError(input: string, decimals: number, symbol: string) {
  if ((input.trim().split(".")[1]?.length ?? 0) <= decimals) return undefined;
  return decimals === 0
    ? `${symbol} has no decimal places`
    : `${symbol} has at most ${decimals} decimal places`;
}

// What Max fills in, from base units: never exponent notation, no locale
// separators, trailing zeros trimmed, an integer for a 0-decimal token.
// Never throws: a missing or malformed balance reads as "0".
export function formatMaxAmount(
  raw: bigint | string | undefined,
  decimals: number,
): string {
  try {
    const value = typeof raw === "bigint" ? raw : BigInt(raw ?? 0);
    return value > 0n ? formatUnits(value, decimals) : "0";
  } catch {
    return "0";
  }
}

// The amount field's keystroke clamp: at most `decimals` fraction digits.
// Anything that is not a plain decimal is left as typed, so the validator can
// name the problem instead of the field silently rewriting it ("2e-8" must
// never become "28").
// The field's one normal form: what the clamp cuts and the validator reads.
export function normalizeDecimalInput(value: string | undefined): string {
  return (value ?? "").trim();
}

// Surrounding whitespace is trimmed first, so " 0.000000001" cannot slip past
// the clamp that the (trimming) validator then accepts.
export function sanitizeDecimalInput(value: string, decimals: number): string {
  const text = normalizeDecimalInput(value);
  if (!PLAIN_DECIMAL.test(text)) return value;
  const [int, frac] = text.split(".");
  if (frac === undefined || frac === "") return text;
  return decimals ? `${int}.${frac.slice(0, decimals)}` : int;
}

// Base units for a plain decimal string, or undefined when it is empty, zero,
// not a plain decimal or more precise than the token. Never throws.
export function parseTokenAmount(
  input: string | undefined,
  decimals: number,
): bigint | undefined {
  const text = (input ?? "").trim();
  if (!PLAIN_DECIMAL.test(text) || text === "" || text === ".")
    return undefined;
  if (decimalsError(text, decimals, "")) return undefined;
  try {
    const value = parseUnits(text, decimals);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

// react-hook-form validator body: runs synchronously inside the form, so it
// returns a message (or "" to keep Next disabled silently) and never throws.
export function validateTokenAmount(
  input: string | undefined,
  {
    decimals,
    symbol,
    spendable,
  }: { decimals: number; symbol: string; spendable?: bigint },
): string | true {
  const text = normalizeDecimalInput(input);
  if (!PLAIN_DECIMAL.test(text)) return NOT_A_DECIMAL;
  const tooPrecise = decimalsError(text, decimals, symbol);
  if (tooPrecise) return tooPrecise;
  const amount = parseTokenAmount(text, decimals);
  // Empty, zero or a lone point: Next stays disabled without a message.
  if (amount === undefined) return "";
  if (spendable !== undefined && amount > spendable) return NOT_ENOUGH_FUNDS;
  return true;
}

// The KRC-20 amount check: validateTokenAmount against the RAW integer balance
// (base units, as the indexer returns it), compared as bigints at the token's
// scale. A float compare rejected an exact Max past 2^53. A missing or
// malformed balance spends as 0.
export function validateKrc20Amount(
  input: string | undefined,
  {
    decimals,
    symbol,
    balance,
  }: { decimals: number; symbol: string; balance: string | undefined },
): string | true {
  const raw = (balance ?? "").trim();
  const spendable = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  return validateTokenAmount(input, { decimals, symbol, spendable });
}

export function isPlainDecimal(input: string | undefined): boolean {
  return PLAIN_DECIMAL.test((input ?? "").trim());
}

// Base units for a plain decimal string, zero included, or undefined when it
// is empty or not a plain decimal. Excess precision rounds as parseUnits does.
// Never throws, so it is safe to call while rendering.
export function parseDecimalUnits(
  input: string | undefined,
  decimals: number,
): bigint | undefined {
  const text = (input ?? "").trim();
  if (!PLAIN_DECIMAL.test(text) || text === "" || text === ".")
    return undefined;
  try {
    return parseUnits(text, decimals);
  } catch {
    return undefined;
  }
}

// A finite positive number's shortest round-trip decimal string, without
// exponent notation ("1e-7" -> "0.0000001", "1e+21" -> "1000...0").
function plainNumberString(value: number): string {
  const s = String(value);
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[1] + (m[2] ?? "");
  const point = 1 + Number(m[3]);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

// A float balance as a plain decimal string truncated to min(decimals, 8)
// places, for when only the float is known. Never exponent notation, and
// never rounds up: the digits are cut from the number's own decimal string
// (toFixed would carry 1.999999999999 up to "2", more than the balance).
// The never-above guarantee is against the float it receives, not the raw
// on-chain balance: past ~15-16 significant digits the double can already sit
// above the balance. The exact path is formatMaxAmount(rawString, dec); this
// is only a fallback.
export function formatFloatAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const digits = Math.min(Math.max(Math.trunc(decimals), 0), 8);
  const plain = plainNumberString(value);
  if (!PLAIN_DECIMAL.test(plain)) return "0";
  const [int, frac = ""] = plain.split(".");
  const kept = frac.slice(0, digits).replace(/0+$/, "");
  return kept ? `${int}.${kept}` : int;
}

// A KRC-20 token's scale from its indexer `dec` string; 8 when absent or
// malformed, matching applyDecimal's default. The send form's Max and clamp
// and the transfer's applyDecimal(dec) must convert with this same scale.
export function krc20Decimals(dec: string | undefined): number {
  // Digits only: "1.5", "-1", "1e1", "0x10" and a blank dec all mean "use 8".
  const text = (dec ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : 8;
}
