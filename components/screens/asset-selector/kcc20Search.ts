import type { Kcc20Token } from "@/lib/kcc20";

/**
 * The send picker's KCC-20 search: a case-insensitive prefix match on every label the row can
 * display (symbol, name, tick, and the covenant id shown as its subtitle). The row renders the
 * KRC-20 display fill, which a list predicate cannot run (it is a per-row hook), so a claimed-only
 * holding with symbol "" and name "NACHO" must still be found by its raw name.
 */
export function matchesKcc20Search(token: Kcc20Token, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  return [
    token.meta?.symbol,
    token.meta?.name,
    token.tick,
    token.covenantId,
  ].some((label) => !!label && label.toLowerCase().startsWith(q));
}
