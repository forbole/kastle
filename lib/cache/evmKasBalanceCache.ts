import { storage } from "wxt/storage";

const PREFIX = "local:cache:evmKasBalance:";

/**
 * Serialisable subset — rawBalance (bigint) is intentionally omitted because
 * bigints are not JSON-serialisable.  Callers that only use `balance` (string)
 * are unaffected; rawBalance is restored as 0n on cache read.
 */
export type EvmKasBalanceCacheEntry = Record<string, string>; // chainId → balance string

/** In-memory mirror — enables synchronous read() for SWR fallbackData */
const mirror = new Map<string, EvmKasBalanceCacheEntry>();

/**
 * Cache for EVM KAS balance per chain, keyed by `networkId:evmAddress`.
 * Written by useEvmKasBalance (multi-chain hook); read (but never written)
 * by useEvmKasBalanceByAddress (single-chain hook) to avoid partial overwrites.
 */
export const evmKasBalanceCache = {
  async load(key: string): Promise<void> {
    const val = await storage.getItem<EvmKasBalanceCacheEntry>(
      `${PREFIX}${key}`,
    );
    if (val != null) mirror.set(key, val);
  },

  read(key: string): EvmKasBalanceCacheEntry | null {
    return mirror.get(key) ?? null;
  },

  async write(key: string, data: EvmKasBalanceCacheEntry): Promise<void> {
    mirror.set(key, data);
    await storage.setItem(`${PREFIX}${key}`, data);
  },

  async clear(key: string): Promise<void> {
    mirror.delete(key);
    await storage.removeItem(`${PREFIX}${key}`);
  },
};
