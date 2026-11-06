import { useMemo, useState } from "react";
import useSWR from "swr";
import type { BraidL1, L1Token } from "@braid_swap/sdk";
import { NetworkType } from "@/contexts/SettingsContext";
import type { Kcc20Family } from "@/lib/kcc20";
import { makeBraid } from "@/lib/braid/client";

// Braid lineage → the Kastle row family whose pieces it spends. A lineage
// with no family (KaspaRocket) is a token this wallet cannot hold.
export const LINEAGE_FAMILY: Record<string, Kcc20Family> = {
  kron: "kron-legacy",
  ref: "kcc20-standard",
};

// The SDK keeps its own copy for a minute; refreshing faster gains nothing.
export const BRAID_TOKENS_TTL_MS = 60_000;

/**
 * Braid's token list. `tokens()` does not throw when Braid's API fails: it
 * answers its pinned table alone, every row `builtin`. A real answer always
 * carries at least one listed (non-builtin) pool, so a list without one is a
 * failed load.
 */
export async function loadBraidTokens(
  braid: Pick<BraidL1, "tokens">,
): Promise<L1Token[]> {
  const tokens = await braid.tokens();
  if (!tokens.some((t) => t.builtin === false)) {
    throw new Error("Braid answered only its pinned tokens");
  }
  return tokens;
}

/**
 * Braid's token list, one SWR entry shared by every reader. A failed refresh
 * keeps the last list SWR holds.
 */
export function useBraidTokens(braid: BraidL1, enabled: boolean) {
  return useSWR(enabled ? "braidTokens" : null, () => loadBraidTokens(braid), {
    refreshInterval: BRAID_TOKENS_TTL_MS,
  });
}

/**
 * A token Braid lists that this wallet can hold, as the selector shows it.
 * Braid's list carries no logo; `decimals` is null where Braid does not know
 * them (its built-in KRON pools), never a guess.
 */
export type BraidRow = {
  covenantId: string;
  family: Kcc20Family;
  name: string;
  symbol: string;
  decimals: number | null;
  logo?: string;
};

/** Braid's tokens narrowed to the lineages a wallet family spends. */
export function braidRows(tokens: L1Token[]): BraidRow[] {
  return tokens.flatMap((t) => {
    const family = t.lineage ? LINEAGE_FAMILY[t.lineage] : undefined;
    if (!t.id || !family) return [];
    return [
      {
        covenantId: t.id,
        family,
        name: t.name || t.symbol,
        symbol: t.symbol,
        decimals: t.decimals,
      },
    ];
  });
}

/**
 * Braid's listing on mainnet, narrowed to the lineages a wallet family
 * spends, so KaspaRocket stays out. Undefined off mainnet and until the list
 * first loads; a failed refresh keeps the last list.
 */
export function useBraidListing(
  networkId: string | undefined,
): BraidRow[] | undefined {
  const [braid] = useState(makeBraid);
  const { data } = useBraidTokens(braid, networkId === NetworkType.Mainnet);
  return useMemo(() => data && braidRows(data), [data]);
}

/**
 * Covenant ids Braid routes and this wallet can spend. Undefined until the
 * list first loads, and for good if it never does: Braid is then simply not
 * offered, KRON is untouched.
 */
export function useBraidRoutable(
  networkId: string | undefined,
): ReadonlySet<string> | undefined {
  const listing = useBraidListing(networkId);
  return useMemo(
    () => listing && new Set(listing.map((r) => r.covenantId)),
    [listing],
  );
}
