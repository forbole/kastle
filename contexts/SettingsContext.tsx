import { createContext, ReactNode, useEffect, useState } from "react";
import { captureException } from "@sentry/react";
import * as conn from "@/lib/settings/connection";
import { kasplexMainnet, kasplexTestnet } from "@/lib/layer2";
import useStorageState from "@/hooks/useStorageState";

export const SETTINGS_KEY = "local:settings";

export const CURRENCIES = [
  ["USD", "United States Dollar", "$"],
  ["EUR", "Euro", "€"],
  ["CNY", "Chinese Yuan", "¥"],
  ["JPY", "Japanese Yen", "¥"],
  ["HKD", "Hong Kong Dollar", "HK$"],
  ["TWD", "New Taiwan Dollar", "NT$"],
  ["RUB", "Russian Ruble", "₽"],
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number][0];

export enum NetworkType {
  Mainnet = "mainnet",
  TestnetT10 = "testnet-10",
}

type SettingsContextType = {
  settings?: Settings;
  setSettings(
    newSettings: Settings | ((prev: Settings) => Settings),
  ): Promise<void>;
  isSettingsLoading: boolean;
};

export type Settings = {
  networkId: NetworkType;
  currency: CurrencyCode;
  lockTimeout: number;
  walletConnections: conn.WalletConnections | undefined; // WalletId -> Account Index -> NetworkId -> WalletConnection[]
  hideBalances: boolean;
  preview: boolean;

  evmL2ChainId?: Record<NetworkType, number | undefined>;
  isLegacyEvmAddressEnabled?: boolean;
};

export const RPC_URLS: Record<NetworkType, string[]> = {
  [NetworkType.Mainnet]: [
    "wss://kastle-mainnet-borsh.rhyzome.co",
    "wss://wrpc.kasia.fyi",
  ],
  [NetworkType.TestnetT10]: ["wss://testnet10-wrpc.kasia.fyi"],
};
export const KASPLEX_API_URLS = {
  [NetworkType.Mainnet]: "https://api.kasplex.org/v1",
  [NetworkType.TestnetT10]: "https://tn10api.kasplex.org/v1",
};
export const KNS_API_URLS = {
  [NetworkType.Mainnet]: "https://api.knsdomains.org/mainnet",
  [NetworkType.TestnetT10]: "https://api.knsdomains.org/tn10",
};

// The production host only indexes mainnet; testnet-10 routes 404 there and
// the NFT tab painted blank on testnet. (Mobile builds the same wrong URL.)
export const KRC721_INDEXER_URLS = {
  [NetworkType.Mainnet]: "https://krc721-indexer.kaspa.com",
  [NetworkType.TestnetT10]: "https://dev-krc721-indexer.kaspa.com",
};

// kaspa.com's image cache, which kaspa.com and mobile draw their grids from.
// Pinata rate-limits a wallet's first page into mostly 429s; this does not.
export const KRC721_CACHE_URLS = {
  [NetworkType.Mainnet]: "https://krc721-cache.kaspa.com/krc721/mainnet",
  [NetworkType.TestnetT10]:
    "https://krc721-cache-dev.kaspa.com/krc721/testnet-10",
};

export const initialSettings = {
  networkId: NetworkType.Mainnet,
  currency: "USD",
  lockTimeout: 5, // Save 5 minutes as default value
  walletConnections: undefined,
  hideBalances: true,
  preview: false,

  evmL2ChainId: {
    [NetworkType.Mainnet]: kasplexMainnet.id,
    [NetworkType.TestnetT10]: kasplexTestnet.id,
  },
  isLegacyEvmAddressEnabled: false,
} satisfies Settings;

export const SettingsContext = createContext<SettingsContextType>({
  settings: undefined,
  isSettingsLoading: true,
  setSettings: () => Promise.reject(new Error("Settings not loaded")),
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings, isLoading] = useStorageState<Settings>(
    SETTINGS_KEY,
    initialSettings,
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        setSettings,
        isSettingsLoading: isLoading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
