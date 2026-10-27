import { formatUnits } from "viem";
import type { KassealToken } from "@/lib/kasseal/api";

export const KAS_DECIMALS = 8;

/**
 * `exact` keeps every decimal: amounts paid, fees and slippage bounds must
 * never be understated. The 4-decimal short form is for display totals only.
 */
interface FormatOptions {
  exact?: boolean;
}

const trim = (v: string, { exact }: FormatOptions) => {
  const [int, frac] = v.split(".");
  const shown = (exact ? frac : frac?.slice(0, 4))?.replace(/0+$/, "");
  return `${BigInt(int).toLocaleString()}${shown ? `.${shown}` : ""}`;
};

export const formatKas = (sompi: bigint, options: FormatOptions = {}) =>
  `${trim(formatUnits(sompi, KAS_DECIMALS), options)} KAS`;

export const formatTokenAmount = (
  units: bigint,
  token: Pick<KassealToken, "decimals" | "ticker">,
  options: FormatOptions = {},
) => `${trim(formatUnits(units, token.decimals), options)} ${token.ticker}`;

/** Curve fill 0–100, or undefined once off the curve. */
export function curvePercent(token: KassealToken): number | undefined {
  if (token.phase !== "bonding" || !token.curve) return undefined;
  const { raisedSompi, targetSompi } = token.curve;
  if (targetSompi === 0n) return 0;
  return Number((raisedSompi * 10_000n) / targetSompi) / 100;
}
