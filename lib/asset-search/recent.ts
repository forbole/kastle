import { useCallback, useEffect, useSyncExternalStore } from "react";
import { browser } from "wxt/browser";
import type { AssetSearchItem } from "@/ui/popup/asset-search/AssetSearchPage";

/**
 * Assets the user picked on the search screen, per network and account
 * address (the same key shape the hidden-tokens module uses). Newest first,
 * capped.
 * Only the row's id/name/kind/logo/network are kept: no balances.
 */
const PREFIX = "recentAssetSearches:";
export const RECENT_SEARCH_LIMIT = 5;

export function recentSearchesKey(networkId?: string, address?: string) {
  return networkId && address ? `${PREFIX}${networkId}:${address}` : undefined;
}

type Entry = { loaded: boolean; items: readonly AssetSearchItem[] };

const EMPTY: Entry = { loaded: false, items: [] };
const cache = new Map<string, Entry>();
// The in-flight first read per key; it never rejects.
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const isItem = (v: unknown): v is AssetSearchItem => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    (o.kind === "asset" || o.kind === "nft")
  );
};

// Read once per key per popup session; later reads come from the cache.
// Resolves once the key is in the cache; a failed read resolves to no recents.
function load(key: string): Promise<void> {
  if (cache.has(key)) return Promise.resolve();
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const read = (async () => {
    let items: AssetSearchItem[] = [];
    try {
      const stored = (await browser.storage.local.get(key))[key];
      if (Array.isArray(stored))
        items = stored.filter(isItem).slice(0, RECENT_SEARCH_LIMIT);
    } catch {
      // Unreadable storage: no recents, never an error.
    }
    pending.delete(key);
    // A save that landed while reading wins over the stale read.
    if (!cache.has(key)) cache.set(key, { loaded: true, items });
    emit();
  })();
  pending.set(key, read);
  return read;
}

async function save(key: string, items: AssetSearchItem[]) {
  cache.set(key, { loaded: true, items });
  emit();
  try {
    await browser.storage.local.set({ [key]: items });
  } catch {
    // The session cache still holds the list; a reload just forgets it.
  }
}

const current = (key: string) => cache.get(key)?.items ?? [];

export async function addRecentSearch(key: string, item: AssetSearchItem) {
  // Merge onto the stored list, not the empty one a pending first read shows.
  await load(key);
  const { id, name, kind, logo, network } = item;
  const next = [
    { id, name, kind, logo, network },
    ...current(key).filter((i) => i.id !== id),
  ].slice(0, RECENT_SEARCH_LIMIT);
  return save(key, next);
}

export function removeRecentSearch(key: string, id: string) {
  return save(
    key,
    current(key).filter((i) => i.id !== id),
  );
}

export function useRecentSearches(key: string | undefined) {
  const entry = useSyncExternalStore(subscribe, () =>
    key ? (cache.get(key) ?? EMPTY) : EMPTY,
  );
  useEffect(() => {
    if (key) void load(key);
  }, [key]);
  const add = useCallback(
    (item: AssetSearchItem) =>
      key ? addRecentSearch(key, item) : Promise.resolve(),
    [key],
  );
  const remove = useCallback(
    (id: string) => (key ? removeRecentSearch(key, id) : Promise.resolve()),
    [key],
  );
  return { recent: entry.items, add, remove };
}
