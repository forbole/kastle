import { storage } from "wxt/storage";

const PREFIX = "local:cache:insDomains:";

/** In-memory mirror — enables synchronous read() for SWR fallbackData */
const mirror = new Map<string, string[]>();

/**
 * Cache for INS domain names owned by an address.
 * The whole list is replaced on each write — names that have been
 * transferred out disappear naturally.
 */
export const insDomainsCache = {
  async load(address: string): Promise<void> {
    const val = await storage.getItem<string[]>(`${PREFIX}${address}`);
    if (val != null) mirror.set(address, val);
  },

  read(address: string): string[] | null {
    return mirror.get(address) ?? null;
  },

  async write(address: string, names: string[]): Promise<void> {
    mirror.set(address, names);
    await storage.setItem(`${PREFIX}${address}`, names);
  },

  async clear(address: string): Promise<void> {
    mirror.delete(address);
    await storage.removeItem(`${PREFIX}${address}`);
  },
};
