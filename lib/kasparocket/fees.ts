import useSWR from "swr";
import { formatUnits } from "viem";
import {
  toJsonSafe,
  type KaspaRocket,
  type TransactionPlan,
} from "@kasparocket/sdk";
import type { FeeLine } from "@/hooks/swap/l1Types";
import { kasparocketPlanToTx } from "./adapter";
import { rocketConfigured } from "./config";

export const KASPAROCKET_PROTOCOL_TTL_MS = 5 * 60_000;

const KAS_DECIMALS = 8;
const toKas = (sompi: bigint) => Number(formatUnits(sompi, KAS_DECIMALS));
const kasLine = (name: string, sompi: bigint, hint: string): FeeLine => {
  const amount = toKas(sompi);
  return { name, symbol: "KAS", amount, display: `${amount} KAS`, hint };
};
// Rates arrive as floats; fees are computed in parts per million.
const PPM = 1_000_000n;

/** The part of `protocol()` the swap screen reads, bigints restored. */
export type KaspaRocketFees = {
  treasuryRate: number;
  treasuryMinSompi: bigint;
  // Kastle is a registered partner, so these are live, not 0.
  partnerRate: number;
  partnerMinSompi: bigint;
  minOrderValueSompi: bigint;
  tokenDecimals: number;
};

type SafeProtocol = {
  fees?: {
    treasuryRate?: unknown;
    treasuryMinSompi?: unknown;
    partnerRate?: unknown;
    partnerMinSompi?: unknown;
  };
  limits?: { minOrderValueSompi?: unknown };
  token?: { decimals?: unknown };
};

const big = (v: unknown): bigint | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  try {
    const b = BigInt(v);
    return b >= 0n ? b : undefined;
  } catch {
    return undefined;
  }
};

const isRate = (r: unknown): r is number =>
  typeof r === "number" && Number.isFinite(r) && r >= 0 && r < 1;

/** Reads the cached JSON-safe protocol back; undefined when any field is off. */
export function kaspaRocketFeesOf(safe: unknown): KaspaRocketFees | undefined {
  const p = (safe ?? {}) as SafeProtocol;
  const treasuryRate = p.fees?.treasuryRate;
  const treasuryMinSompi = big(p.fees?.treasuryMinSompi);
  const partnerRate = p.fees?.partnerRate;
  const partnerMinSompi = big(p.fees?.partnerMinSompi);
  const minOrderValueSompi = big(p.limits?.minOrderValueSompi);
  const tokenDecimals = p.token?.decimals;
  if (
    !isRate(treasuryRate) ||
    !isRate(partnerRate) ||
    treasuryRate + partnerRate >= 1 ||
    treasuryMinSompi === undefined ||
    partnerMinSompi === undefined ||
    minOrderValueSompi === undefined ||
    typeof tokenDecimals !== "number" ||
    !Number.isInteger(tokenDecimals)
  ) {
    return undefined;
  }
  return {
    treasuryRate,
    treasuryMinSompi,
    partnerRate,
    partnerMinSompi,
    minOrderValueSompi,
    tokenDecimals,
  };
}

/** The protocol's SWR key: none (so no request) while off or unconfigured. */
export const kaspaRocketProtocolKey = (enabled: boolean) =>
  enabled && rocketConfigured() ? "kasparocketProtocol" : null;

/**
 * KaspaRocket's live fee schedule and limits. Cached JSON-safe (SWR's cache
 * may be serialised, and a bigint would throw there); undefined until it
 * loads, so no caller ever falls back to a guessed figure.
 */
export function useKaspaRocketProtocol(client: KaspaRocket, enabled: boolean) {
  const { data, error } = useSWR(
    kaspaRocketProtocolKey(enabled),
    async () => toJsonSafe(await client.protocol()),
    { refreshInterval: KASPAROCKET_PROTOCOL_TTL_MS },
  );
  return { fees: data ? kaspaRocketFeesOf(data) : undefined, error };
}

const cut = (kasSompi: bigint, rate: number, minSompi: bigint) => {
  const byRate = (kasSompi * BigInt(Math.round(rate * 1e6))) / PPM;
  return byRate > minSompi ? byRate : minSompi;
};

/**
 * What a trade moving `kasSompi` pays KaspaRocket in all: the treasury's cut
 * and the partner's, each a rate with a floor, as the SDK's quote splits it.
 * Both come from protocol(); a schedule with no partner has its figures at 0.
 */
export function kaspaRocketFeeSompi(
  kasSompi: bigint,
  fees: KaspaRocketFees,
): bigint {
  return (
    cut(kasSompi, fees.treasuryRate, fees.treasuryMinSompi) +
    cut(kasSompi, fees.partnerRate, fees.partnerMinSompi)
  );
}

/** protocol()'s fee wording: "1.5% of the KAS traded, at least 3 KAS". */
export const kaspaRocketFeeHint = (fees: KaspaRocketFees) =>
  `${+((fees.treasuryRate + fees.partnerRate) * 100).toFixed(4)}% of the KAS traded, at least ${toKas(fees.treasuryMinSompi + fees.partnerMinSompi)} KAS`;

/** No line until the schedule and the KAS amount are both known: never a 0. */
export function kaspaRocketFeeLine(
  kasSompi: bigint | undefined,
  fees: KaspaRocketFees | undefined,
): FeeLine | undefined {
  if (!fees || kasSompi === undefined || kasSompi <= 0n) return undefined;
  return kasLine(
    "KaspaRocket",
    kaspaRocketFeeSompi(kasSompi, fees),
    kaspaRocketFeeHint(fees),
  );
}

/** Why a trade moving `kasSompi` is too small for KaspaRocket, if it is. */
export function kaspaRocketMinOrderError(
  kasSompi: bigint,
  fees: KaspaRocketFees | undefined,
): string | undefined {
  if (!fees || kasSompi <= 0n || kasSompi >= fees.minOrderValueSompi) {
    return undefined;
  }
  return `KaspaRocket's minimum trade is ${toKas(fees.minOrderValueSompi)} KAS.`;
}

/**
 * The network fee a plan pays: what its inputs spend less what its outputs
 * pay, over every transaction. Undefined when a transaction cannot be read.
 */
export function kaspaRocketPlanNetworkFee(
  plan: TransactionPlan,
): bigint | undefined {
  try {
    let fee = 0n;
    for (const { tx } of plan.transactions) {
      const t = kasparocketPlanToTx(tx);
      for (const i of t.inputs) fee += BigInt(i.utxo!.amount);
      for (const o of t.outputs) fee -= BigInt(o.value);
    }
    return fee >= 0n ? fee : undefined;
  } catch {
    return undefined;
  }
}

/** A network fee line from a plan's own transactions; none if unreadable. */
export function kaspaRocketNetworkFeeLine(
  plan: TransactionPlan | undefined,
): FeeLine | undefined {
  const fee = plan ? kaspaRocketPlanNetworkFee(plan) : undefined;
  if (fee === undefined) return undefined;
  return kasLine("Network", fee, "Set by the swap KaspaRocket built");
}

/**
 * KaspaRocket's own fee as the plan states it (treasury plus partner), with
 * protocol()'s wording as the hint. No line when the plan states none.
 */
export function kaspaRocketPlanFeeLine(
  plan: TransactionPlan | undefined,
  hint: string | undefined,
): FeeLine | undefined {
  const s = plan?.summary;
  const fee = s?.totalPlatformFeeSompi ?? s?.platformFeeSompi;
  if (typeof fee !== "bigint" || fee < 0n) return undefined;
  return kasLine(
    "KaspaRocket",
    fee,
    hint ?? "Stated by the swap KaspaRocket built",
  );
}
