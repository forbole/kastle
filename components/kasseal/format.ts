import { formatUnits } from "viem";
import type { KassealToken } from "@/lib/kasseal/api";

export const KAS_DECIMALS = 8;

const trim = (v: string) => {
  const [int, frac] = v.split(".");
  const shown = frac?.slice(0, 4).replace(/0+$/, "");
  return `${Number(int).toLocaleString()}${shown ? `.${shown}` : ""}`;
};

export const formatKas = (sompi: bigint) =>
  `${trim(formatUnits(sompi, KAS_DECIMALS))} KAS`;

export const formatTokenAmount = (units: bigint, token: KassealToken) =>
  `${trim(formatUnits(units, token.decimals))} ${token.ticker}`;

/** Curve fill 0–100, or undefined once off the curve. */
export function curvePercent(token: KassealToken): number | undefined {
  if (token.phase !== "bonding" || !token.curve) return undefined;
  const { raisedSompi, targetSompi } = token.curve;
  if (targetSompi === 0n) return 0;
  return Number((raisedSompi * 10_000n) / targetSompi) / 100;
}
