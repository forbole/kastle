import { storage } from "wxt/storage";
import type { TokenItem } from "@/hooks/kasplex/useTokenListByAddress";

const PREFIX = "local:cache:krc20Balance:";

/** In-memory mirror — enables synchronous read() for SWR fallbackData */
const mirror = new Map<string, TokenItem[]>();

/**
 * Cache for KRC20 token list with balances per address.
 * The whole list is replaced on each write — tokens that have been fully
 * transferred out disappear naturally.
 */
export const krc20BalanceCache = {
  async load(address: string): Promise<void> {
    const val = await storage.getItem<TokenItem[]>(`${PREFIX}${address}`);
    if (val != null) mirror.set(address, val);
  },

  read(address: string): TokenItem[] | null {
    return mirror.get(address) ?? null;
  },

  async write(address: string, tokens: TokenItem[]): Promise<void> {
    mirror.set(address, tokens);
    await storage.setItem(`${PREFIX}${address}`, tokens);
  },

  async clear(address: string): Promise<void> {
    mirror.delete(address);
    await storage.removeItem(`${PREFIX}${address}`);
  },
};
