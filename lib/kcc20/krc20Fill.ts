import type { Kcc20Token } from "@/lib/kcc20";

/** A KRC-20 (Kasplex) list entry; `logoURI` is a full URL. */
export type Krc20Entry = {
  symbol: string;
  decimals?: number;
  logoURI?: string;
};

/**
 * `token` with the metadata fields it leaves empty taken from the one KRC-20 entry it can
 * be tied to: its ticker when it has one, else the name kascov published. Decimals are
 * never filled: a scale from another standard would misstate the balance. A field the
 * KCC-20 row already sets is never overwritten; no entry, or more than one, fills nothing
 * (a wrong logo is worse than none). Display only: the send form reads the unfilled row.
 */
export function fillFromKrc20(
  token: Kcc20Token,
  krc20: readonly Krc20Entry[] | undefined,
): Kcc20Token {
  const { meta } = token;
  const key = (meta?.symbol || token.tick || meta?.name)?.toUpperCase();
  const hits = key
    ? (krc20 ?? []).filter((e) => e.symbol.toUpperCase() === key)
    : [];
  if (hits.length !== 1) return token;
  const [hit] = hits;
  const symbol = meta?.symbol || token.tick || hit.symbol;
  // Decimals belong to the covenant; the KRC-20 namesake is another issuance (NACHO: 6 vs 8).
  const decimals = meta?.decimals;
  const logoURI = meta?.logoURI || hit.logoURI;
  return {
    ...token,
    meta: {
      symbol,
      name: meta?.name || symbol,
      ...(decimals !== undefined && { decimals }),
      ...(logoURI && { logoURI }),
      unverified: true,
    },
  };
}
