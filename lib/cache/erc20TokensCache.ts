import { storage } from "wxt/storage";
import type { Address, Hex } from "viem";

const PREFIX = "local:cache:erc20Tokens:";

/**
 * Minimal token descriptor stored in cache.
 * name, symbol, icon_url, and value are stripped — they can be reconstructed
 * with placeholder defaults when restoring fallbackData.
 */
export type Erc20TokensCacheItem = {
  address_hash: Address;
  decimals: string;
};

export type Erc20TokensChainCache = {
  chainId: Hex;
  tokens: Erc20TokensCacheItem[];
};

/** In-memory mirror — enables synchronous read() for SWR fallbackData */
const mirror = new Map<string, Erc20TokensChainCache[]>();

/**
 * Cache for ERC20 token list (which tokens the address holds, per chain).
 * Keyed by `networkId:evmAddress`.
 *
 * This cache is a prerequisite for erc20BalanceCache — without it the
 * useErc20BalancesByAddress SWR key stays null (it depends on erc20TokensData)
 * and fallbackData never fires.
 */
export const erc20TokensCache = {
  async load(key: string): Promise<void> {
    const val = await storage.getItem<Erc20TokensChainCache[]>(
      `${PREFIX}${key}`,
    );
    if (val != null) mirror.set(key, val);
  },

  read(key: string): Erc20TokensChainCache[] | null {
    return mirror.get(key) ?? null;
  },

  async write(key: string, data: Erc20TokensChainCache[]): Promise<void> {
    mirror.set(key, data);
    await storage.setItem(`${PREFIX}${key}`, data);
  },

  async clear(key: string): Promise<void> {
    mirror.delete(key);
    await storage.removeItem(`${PREFIX}${key}`);
  },
};
