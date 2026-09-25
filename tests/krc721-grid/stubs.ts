// Stubs for the hooks NftList and the KRC721 screen reach into. Scenario
// knobs come from the page's query string (see main.tsx) so one build serves
// every test.
import { useState } from "react";

declare global {
  interface Window {
    __h: {
      networkId: string;
      address: string;
      walletType: string;
      erc721Pages: { chainId: string; chainIndex: number; items: unknown[] }[];
    };
    __storage: Map<string, unknown>;
  }
}
const h = () => window.__h;

export function useWalletManager() {
  return {
    account: { address: h().address, publicKeys: [] },
    wallet: { type: h().walletType },
  };
}

export function useRpcClientStateful() {
  return { networkId: h().networkId };
}

export function useKRC721RecentTransfer() {
  return { isRecentKRC721Transfer: () => false };
}

// Same return shape as the real hook. Two pages = two chains, so hasNextPage
// is true after page 0 exactly as the real hook computes it on mainnet.
export function useErc721AssetsFromApi() {
  const [size, setSize] = useState(1);
  const all = h().erc721Pages;
  const pages = all.slice(0, size);
  return {
    data: pages,
    size,
    setSize: (n: number | ((p: number) => number)) =>
      setSize((p) => (typeof n === "function" ? n(p) : n)),
    isLoading: false,
    hasNextPage: pages.length < all.length,
    error: undefined,
    mutate: () => Promise.resolve(),
  };
}

// In-memory wxt/storage.
window.__storage = new Map();
export const storage = {
  async getItem<T>(key: string): Promise<T | null> {
    return (window.__storage.get(key) as T) ?? null;
  },
  async setItem(key: string, value: unknown): Promise<void> {
    window.__storage.set(key, value);
  },
};

// SettingsContext's / lib/utils' heavy imports; the constants under test
// stay real.
// The real Method is an enum (a value), so a type export would be stripped.
export const Method = new Proxy({} as Record<string, string>, {
  get: (_, k) => String(k),
});
export type WalletConnections = Record<string, unknown>;
export const captureException = () => {};
export const kasplexMainnet = { id: 167012 };
export const kasplexTestnet = { id: 167012 };
// lib/ins/insRegistry builds its viem client from this at import time; the
// URL is never dialled by the grid.
export const igraMainnet = {
  id: 38833,
  rpcUrls: { default: { http: ["http://127.0.0.1:9"] } },
};
export default function useStorageState() {
  return [undefined, async () => {}, false];
}
