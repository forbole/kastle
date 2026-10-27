import type { KassealNetwork } from "@kassealhq/sdk";
import type { KassealToken } from "./api";
import type { KassealVenue } from "./trade";

export const venueOf = (token: KassealToken): KassealVenue =>
  token.phase === "bonding" ? "curve" : "pool";

/** Launch proof and curve params: the curve key moves with every lot sold. */
export function kassealMarketKey(
  network: KassealNetwork | undefined,
  token: KassealToken | undefined,
  ownKey: string | undefined,
) {
  if (!network || !token || !ownKey) return null;
  return [
    "kassealMarket",
    network,
    token.covenantId,
    venueOf(token),
    token.curve?.lotsSold,
  ] as const;
}

/**
 * Pool reserves move with every swap. The key follows the token's market
 * cap, which the token poll refreshes; the snapshot also polls on its own.
 */
export function kassealPoolKey(
  network: KassealNetwork | undefined,
  token: KassealToken | undefined,
  poolId: string | undefined,
) {
  if (!network || !token || !poolId || venueOf(token) !== "pool") return null;
  return [
    "kassealPool",
    network,
    poolId,
    token.marketCapSompi?.toString(),
  ] as const;
}

export const KASSEAL_POOL_SWR = {
  refreshInterval: 15_000,
  revalidateOnFocus: true,
  shouldRetryOnError: false,
} as const;
