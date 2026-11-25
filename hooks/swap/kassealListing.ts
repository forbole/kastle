import { useMemo } from "react";
import { kassealRoutable } from "@/lib/kasseal/market";
import useKassealTokens from "@/lib/kasseal/useKassealTokens";

/**
 * `L1Listings.kasseal`. One SWR entry (useKassealTokens, 30 s refresh) keyed
 * by the settings network, mainnet or testnet-10; a failed refresh keeps the
 * last good list. Off, or before the first answer: undefined, not offered.
 */
// Ceiling: the list is the API's first page (50 most active); a token past it
// is simply not offered. Page through fetchKassealTokens if that bites.
export function useKassealListing(
  enabled: boolean,
): ReadonlySet<string> | undefined {
  const { data } = useKassealTokens(undefined, enabled);
  return useMemo(
    () => (enabled ? kassealRoutable(data) : undefined),
    [enabled, data],
  );
}
