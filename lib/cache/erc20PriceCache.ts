import { storage } from "wxt/storage";

const STORAGE_KEY = "local:cache:erc20Prices";

/** In-memory mirror: "chainId:address" → price in USD */
let mirror: Record<string, number> | null = null;

/**
 * Global cache for ERC20 token prices in USD (Record<"chainId:address", priceUSD>).
 * Provider-agnostic by design — cache lives at the normalised Erc20PriceEntry[]
 * layer in useErc20Prices, not inside individual provider hooks.
 * Uses merge() so adding a new price provider requires no cache changes.
 */
export const erc20PriceCache = {
  async load(): Promise<void> {
    const val = await storage.getItem<Record<string, number>>(STORAGE_KEY);
    mirror = val ?? {};
  },

  read(): Record<string, number> | null {
    return mirror;
  },

  /**
   * Merge an array of live price entries.  Called after all providers have
   * been combined in useErc20Prices.
   */
  async merge(
    entries: Array<{ chainId: string; address: string; price: number }>,
  ): Promise<void> {
    const update: Record<string, number> = {};
    for (const e of entries) {
      update[`${e.chainId}:${e.address}`] = e.price;
    }
    mirror = { ...(mirror ?? {}), ...update };
    await storage.setItem(STORAGE_KEY, mirror);
  },

  async clear(): Promise<void> {
    mirror = {};
    await storage.removeItem(STORAGE_KEY);
  },
};
