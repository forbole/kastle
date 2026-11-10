import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { browser } from "wxt/browser";

/**
 * Tokens the user hid from the dashboard list, per network and account address.
 * A display filter, app-wide: every holdings list (dashboard, send picker,
 * swap selectors) drops hidden rows through useVisibleTokens. Balances,
 * totals, sendability, detail routes and history never read it, so a hidden
 * token keeps its money numbers and stays reachable by route.
 */
const PREFIX = "hiddenTokens:";

export function hiddenTokensKey(networkId?: string, address?: string) {
  return networkId && address ? `${PREFIX}${networkId}:${address}` : undefined;
}

export const krc20HideId = (tick: string) => `krc20:${tick.toLowerCase()}`;
export const kcc20HideId = (covenantId: string, ext?: string) =>
  `kcc20:${covenantId}${ext ? `:${ext}` : ""}`;
export const erc20HideId = (chainId: string, address: string) =>
  `erc20:${chainId}:${address.toLowerCase()}`;

type Entry = { loaded: boolean; hidden: ReadonlySet<string> };

const EMPTY: Entry = { loaded: false, hidden: new Set() };
const cache = new Map<string, Entry>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// Read once per key per popup session; later reads come from the cache.
async function load(key: string) {
  if (cache.has(key) || pending.has(key)) return;
  pending.add(key);
  let ids: string[] = [];
  try {
    const stored = (await browser.storage.local.get(key))[key];
    if (Array.isArray(stored))
      ids = stored.filter((id): id is string => typeof id === "string");
  } catch {
    // Unreadable storage hides nothing; the list stays whole.
  }
  pending.delete(key);
  // A save that landed while reading wins over the stale read.
  if (!cache.has(key)) cache.set(key, { loaded: true, hidden: new Set(ids) });
  emit();
}

export async function saveHiddenTokens(key: string, ids: Iterable<string>) {
  const hidden = new Set(ids);
  cache.set(key, { loaded: true, hidden });
  emit();
  await browser.storage.local.set({ [key]: [...hidden] });
}

/** Test seam: forget the session cache, as a popup reload does. */
export function resetHiddenTokensCache() {
  cache.clear();
  pending.clear();
  emit();
}

export function useHiddenTokens(key: string | undefined) {
  const entry = useSyncExternalStore(subscribe, () =>
    key ? (cache.get(key) ?? EMPTY) : EMPTY,
  );
  useEffect(() => {
    if (key) void load(key);
  }, [key]);
  const save = useCallback(
    (ids: Iterable<string>) =>
      key ? saveHiddenTokens(key, ids) : Promise.resolve(),
    [key],
  );
  return { hidden: entry.hidden, loaded: !key || entry.loaded, save };
}

// Row -> hide id, one per standard; the same inputs the dashboard writes with.
export const krc20RowHideId = (t: { id: string }) => krc20HideId(t.id);
export const kcc20RowHideId = (t: {
  covenantId: string;
  extensionCommitment?: string;
}) => kcc20HideId(t.covenantId, t.extensionCommitment);
export const erc20RowHideId = (a: { chainId: string; address: string }) =>
  erc20HideId(a.chainId, a.address);

/**
 * A swap sheet row's hide id: Kaspa L1 rows carry the covenant id in
 * `address` (one row per covenant, so it matches the base KCC-20 row), EVM
 * rows an ERC-20 address on `evmChainId`. Native rows (no address) never hide.
 */
export const swapRowHideId = (
  row: { chain: string; address?: string },
  evmChainId?: string,
) => {
  if (!row.address) return undefined;
  if (row.chain === "kaspa") return kcc20HideId(row.address);
  return evmChainId ? erc20HideId(evmChainId, row.address) : undefined;
};

/** `items` without the hidden rows; a row with no id (native coin) always stays. */
export function visibleTokens<T>(
  hidden: ReadonlySet<string>,
  items: T[],
  idOf: (item: T) => string | undefined,
): T[] {
  if (hidden.size === 0) return items;
  return items.filter((item) => {
    const id = idOf(item);
    return id === undefined || !hidden.has(id);
  });
}

/**
 * The visible rows of one list. Until storage is read (`loaded` false) the
 * hidden set is empty, so the whole list renders and then settles: never a
 * blank panel. Pass a stable `idOf` (module level) so the memo holds.
 */
export function useVisibleTokens<T>(
  key: string | undefined,
  items: T[] | undefined,
  idOf: (item: T) => string | undefined,
): { items: T[] | undefined; loaded: boolean } {
  const { hidden, loaded } = useHiddenTokens(key);
  const visible = useMemo(
    () => items && visibleTokens(hidden, items, idOf),
    [items, hidden, idOf],
  );
  return { items: visible, loaded };
}
