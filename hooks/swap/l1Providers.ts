import { useState } from "react";
import { NetworkType } from "@/contexts/SettingsContext";
import { BRAID_PROVIDER } from "@/lib/braid/constants";
import type { KronMarket } from "@/lib/kcc20/swap";

export type L1ProviderId = "kron" | typeof BRAID_PROVIDER.id;

/** A Kaspa L1 swap leg: KAS, or a KCC-20 token by its covenant id. */
export type L1Leg = { type: "KAS" } | { type: "KCC20"; covenantId: string };

// What each provider's own listing says it routes, by covenant id.
// Undefined while unknown: the provider that needs it is then not offered.
export type L1Listings = {
  kron?: ReadonlySet<string>;
  braid?: ReadonlySet<string>;
};

export type L1Provider = {
  id: L1ProviderId;
  name: string;
  supports: (
    a?: L1Leg,
    b?: L1Leg,
    networkId?: string,
    listings?: L1Listings,
  ) => boolean;
};

/**
 * KRON's listing: the curve markets the screen already reads. A graduated
 * token rides on `graduated`, not in the array, so it is absent here.
 */
export function kronListing(
  markets?: readonly KronMarket[],
): ReadonlySet<string> | undefined {
  return markets && new Set(markets.map((m) => m.covenantId));
}

// A KAS leg and a KCC-20 leg, either way round.
const kcc20Of = (a?: L1Leg, b?: L1Leg) =>
  a?.type === "KAS" && b?.type === "KCC20"
    ? b
    : a?.type === "KCC20" && b?.type === "KAS"
      ? a
      : undefined;

// KRON first: it is the default for a pair both providers support.
export const L1_PROVIDERS: readonly L1Provider[] = [
  {
    id: "kron",
    name: "KRON",
    // Only a curve token: a graduated one has left the curve KRON trades on.
    supports: (a, b, _networkId, listings) => {
      const token = kcc20Of(a, b);
      return !!token && !!listings?.kron?.has(token.covenantId);
    },
  },
  {
    ...BRAID_PROVIDER,
    // Only a token Braid lists: it refuses any other with UNKNOWN_TOKEN.
    supports: (a, b, networkId, listings) => {
      const token = kcc20Of(a, b);
      return (
        networkId === NetworkType.Mainnet &&
        !!token &&
        !!listings?.braid?.has(token.covenantId)
      );
    },
  },
];

function firstSupporting(
  a?: L1Leg,
  b?: L1Leg,
  networkId?: string,
  listings?: L1Listings,
) {
  return L1_PROVIDERS.find((p) => p.supports(a, b, networkId, listings));
}

/** Whether any provider routes the pair, as opposed to the fallback entry. */
export function hasL1Route(
  a?: L1Leg,
  b?: L1Leg,
  networkId?: string,
  listings?: L1Listings,
): boolean {
  return !!firstSupporting(a, b, networkId, listings);
}

/**
 * The provider a Kaspa L1 pair trades through. A choice that does not
 * support the pair yields the first provider that does, without being
 * forgotten: it applies again once the pair fits it. Support depends on the
 * network (Braid is mainnet only) and on each provider's own listing (KRON
 * routes only curve tokens, Braid only tokens it lists). With no supporting
 * provider it is the first entry, so the screen always has a name to show.
 */
export function useL1Provider(
  a?: L1Leg,
  b?: L1Leg,
  networkId?: string,
  listings?: L1Listings,
): [L1ProviderId, (id: L1ProviderId) => void] {
  const [chosen, setChosen] = useState<L1ProviderId>(
    () => (firstSupporting(a, b, networkId, listings) ?? L1_PROVIDERS[0]).id,
  );
  const current = L1_PROVIDERS.find((p) => p.id === chosen);
  const id = current?.supports(a, b, networkId, listings)
    ? chosen
    : (firstSupporting(a, b, networkId, listings) ?? L1_PROVIDERS[0]).id;
  return [id, setChosen];
}
