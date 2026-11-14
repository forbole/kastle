import type { HistoryRecord } from "@/lib/history/types";

const NONE = { value: null, quality: "unavailable" } as const;

/**
 * Token scale as a non-negative integer, or undefined when it is not one. A
 * string must be all digits ("0" passes: an integer-decimal token), so an empty,
 * fractional or negative value is no scale rather than `Number("")` = 0, which
 * would price raw base units as whole tokens.
 */
function scaleOf(decimals: number | string | null | undefined) {
  const n =
    typeof decimals === "string"
      ? /^\d+$/.test(decimals)
        ? Number(decimals)
        : NaN
      : decimals;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0
    ? n
    : undefined;
}

/**
 * USD value of an exact base-unit amount at the current price, hence
 * approximate. Scaled by the token's own decimals from the integer, never base
 * units read as whole tokens. A missing or non-positive price is no price
 * (never $0.00), and an unknown scale or unparsable amount has no value.
 */
export function approxFiat(
  raw: bigint | string | undefined,
  decimalsIn: number | string | null | undefined,
  usdPrice: number | undefined,
): HistoryRecord["fiat"] {
  const decimals = scaleOf(decimalsIn);
  if (
    raw === undefined ||
    usdPrice === undefined ||
    !Number.isFinite(usdPrice) ||
    usdPrice <= 0 ||
    decimals === undefined
  )
    return NONE;
  let big: bigint;
  try {
    big = typeof raw === "bigint" ? raw : BigInt(raw);
  } catch {
    return NONE;
  }
  if (big < 0n) big = -big;
  const scale = 10n ** BigInt(decimals);
  const whole = Number(big / scale) + Number(big % scale) / 10 ** decimals;
  return { value: { usd: whole * usdPrice }, quality: "approximate" };
}
