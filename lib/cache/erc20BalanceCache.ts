import { storage } from "wxt/storage";
import type { Address } from "viem";

const PREFIX = "local:cache:erc20Balance:";

/**
 * Serialisable subset of a successful balance result.
 * rawBalance (bigint) is omitted — not JSON-serialisable.
 * Only successful items (no `error` field) are ever stored.
 */
export type Erc20BalanceCacheItem = {
  tokenAddress: Address;
  chainId: string;
  decimals: number;
  balance: number;
};

/** In-memory mirror — enables synchronous read() for SWR fallbackData */
const mirror = new Map<string, Erc20BalanceCacheItem[]>();

/**
 * Cache for ERC20 token balances keyed by `networkId:evmAddress`.
 */
export const erc20BalanceCache = {
  async load(key: string): Promise<void> {
    const val = await storage.getItem<Erc20BalanceCacheItem[]>(
      `${PREFIX}${key}`,
    );
    if (val != null) mirror.set(key, val);
  },

  read(key: string): Erc20BalanceCacheItem[] | null {
    return mirror.get(key) ?? null;
  },

  async write(key: string, items: Erc20BalanceCacheItem[]): Promise<void> {
    mirror.set(key, items);
    await storage.setItem(`${PREFIX}${key}`, items);
  },

  async clear(key: string): Promise<void> {
    mirror.delete(key);
    await storage.removeItem(`${PREFIX}${key}`);
  },
};
