import { useState } from "react";
import braidLogo from "@/assets/images/providers/braid-logo.svg";
import kronLogo from "@/assets/images/providers/kron-logo.png";
import { NetworkType } from "@/contexts/SettingsContext";
import { BRAID_PROVIDER } from "@/lib/braid/constants";
import type { KronMarket } from "@/lib/kcc20/swap";
import type { useFeatureFlags } from "@/hooks/useFeatureFlags";

// Open: a provider registers its own id.
export type L1ProviderId =
  | "kasseal"
  | "kron"
  | typeof BRAID_PROVIDER.id
  | (string & NonNullable<unknown>);

export type L1FeatureFlags = ReturnType<typeof useFeatureFlags>;

/** A Kaspa L1 swap leg: KAS, or a KCC-20 token by its covenant id. */
export type L1Leg = { type: "KAS" } | { type: "KCC20"; covenantId: string };

// What each provider's own listing says it routes, by covenant id.
// Undefined while unknown: the provider that needs it is then not offered.
export type L1Listings = Partial<Record<L1ProviderId, ReadonlySet<string>>>;

export type L1Provider = {
  id: L1ProviderId;
  name: string;
  /** The provider's own mark (braidswap.com favicon, kron.technology nav logo); absent: name only. */
  image?: string;
  supports: (
    a?: L1Leg,
    b?: L1Leg,
    networkId?: string,
    listings?: L1Listings,
  ) => boolean;
  /** Off: no sheet row at all. Absent: always on. */
  enabled?: (flags: L1FeatureFlags) => boolean;
};

export const isL1Enabled = (p: L1Provider, flags: L1FeatureFlags) =>
  p.enabled?.(flags) ?? true;

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

/** Networks Kasseal is offered on; testnet-10 so it can be QA'd. */
export const KASSEAL_NETWORKS: readonly string[] = [
  NetworkType.Mainnet,
  NetworkType.TestnetT10,
];

// Kasseal first, as on mobile: the default for a pair it routes; KRON next,
// then Braid. A choice of a later one sticks while the pair still fits it.
export const L1_PROVIDERS: readonly L1Provider[] = [
  {
    id: "kasseal",
    name: "Kasseal",
    enabled: (flags) => flags.isKassealEnabled,
    // Only a curve token Kasseal's own listing routes (useKassealListing).
    supports: (a, b, networkId, listings) => {
      const token = kcc20Of(a, b);
      return (
        KASSEAL_NETWORKS.includes(networkId ?? "") &&
        !!token &&
        !!listings?.kasseal?.has(token.covenantId)
      );
    },
  },
  {
    id: "kron",
    name: "KRON",
    image: kronLogo,
    // Only a curve token: a graduated one has left the curve KRON trades on.
    supports: (a, b, _networkId, listings) => {
      const token = kcc20Of(a, b);
      return !!token && !!listings?.kron?.has(token.covenantId);
    },
  },
  {
    ...BRAID_PROVIDER,
    image: braidLogo,
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

// No provider routes the pair: KRON, always on and the screen's inline path,
// never a flagged provider that may be off.
const L1_FALLBACK = L1_PROVIDERS.find((p) => p.id === "kron")!;

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
 * provider it is KRON (L1_FALLBACK), so the screen always has a name to show.
 */
export function useL1Provider(
  a?: L1Leg,
  b?: L1Leg,
  networkId?: string,
  listings?: L1Listings,
): [L1ProviderId, (id: L1ProviderId) => void] {
  // Only the user's own pick is state: a default taken at mount (often the
  // fallback, before any listing loads) must not outrank Kasseal later.
  const [chosen, setChosen] = useState<L1ProviderId>();
  const current = L1_PROVIDERS.find((p) => p.id === chosen);
  const id = current?.supports(a, b, networkId, listings)
    ? current.id
    : (firstSupporting(a, b, networkId, listings) ?? L1_FALLBACK).id;
  return [id, setChosen];
}
