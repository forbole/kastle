import { useCallback, useEffect, useSyncExternalStore } from "react";
import { browser } from "wxt/browser";

/**
 * Tokens the user hid from the dashboard list, per network and account address.
 * A display filter only: nothing else (send, swap, detail, holdings, totals)
 * reads it, so a hidden token stays spendable and visible everywhere else.
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
