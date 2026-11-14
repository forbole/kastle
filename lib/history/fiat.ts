import type { HistoryRecord } from "@/lib/history/types";

const NONE = { value: null, quality: "unavailable" } as const;

/**
 * USD value of an exact base-unit amount at the current price, hence
 * approximate. Scaled by the token's own decimals from the integer, never base
 * units read as whole tokens. A missing or non-positive price is no price
 * (never $0.00), and an unknown scale or unparsable amount has no value.
 */
export function approxFiat(
  raw: bigint | string | undefined,
  decimals: number | undefined,
  usdPrice: number | undefined,
): HistoryRecord["fiat"] {
  if (
    raw === undefined ||
    usdPrice === undefined ||
    !Number.isFinite(usdPrice) ||
    usdPrice <= 0 ||
    decimals === undefined ||
    !Number.isInteger(decimals) ||
    decimals < 0
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
