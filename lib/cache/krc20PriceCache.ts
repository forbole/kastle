import { storage } from "wxt/storage";

const STORAGE_KEY = "local:cache:krc20Prices";

/** In-memory mirror: ticker → floor price in KAS */
let mirror: Record<string, number> | null = null;

/**
 * Global cache for KRC20 floor prices (Record<ticker, floorPriceInKAS>).
 * Uses merge() so single-ticker callers (useKrc20Prices) and batch callers
 * (useKrc20TotalPriceInUsd) can both write without clobbering each other.
 */
export const krc20PriceCache = {
  async load(): Promise<void> {
    const val = await storage.getItem<Record<string, number>>(STORAGE_KEY);
    mirror = val ?? {};
  },

  read(): Record<string, number> | null {
    return mirror;
  },

  /** Merge a single ticker's price into the global cache. */
  async merge(ticker: string, priceInKAS: number): Promise<void> {
    mirror = { ...(mirror ?? {}), [ticker]: priceInKAS };
    await storage.setItem(STORAGE_KEY, mirror);
  },

  async clear(): Promise<void> {
    mirror = {};
    await storage.removeItem(STORAGE_KEY);
  },
};
