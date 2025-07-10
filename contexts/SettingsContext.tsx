import { createContext, ReactNode, useEffect, useState } from "react";
import { captureException } from "@sentry/react";
import * as conn from "@/lib/settings/connection";
import { kasplexTestnet } from "@/lib/layer2";

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
  isLegacyEvmAddress?: boolean;
};

export const RPC_URLS = {
  [NetworkType.Mainnet]: "wss://kaspa-mainnet.forbole.com/borsh",
  [NetworkType.TestnetT10]: "wss://kaspa-testnet.forbole.com/borsh",
};
export const KASPLEX_API_URLS = {
  [NetworkType.Mainnet]: "https://api.kasplex.org/v1",
  [NetworkType.TestnetT10]: "https://tn10api.kasplex.org/v1",
};
export const KNS_API_URLS = {
  [NetworkType.Mainnet]: "https://api.knsdomains.org/mainnet",
  [NetworkType.TestnetT10]: "https://api.knsdomains.org/tn10",
};

export const KRC721_API_URLS = {
  [NetworkType.Mainnet]: "https://mainnet.krc721.stream",
  [NetworkType.TestnetT10]: "https://testnet-10.krc721.stream",
};

export const KRC721_CACHE_URLS = {
  [NetworkType.Mainnet]: "https://cache.krc721.stream/krc721/mainnet",
  [NetworkType.TestnetT10]: "https://cache.krc721.stream/krc721/testnet-10",
};

const initialSettings = {
  networkId: NetworkType.Mainnet,
  currency: "USD",
  lockTimeout: 5, // Save 5 minutes as default value
  walletConnections: undefined,
  hideBalances: true,
  preview: false,

  evmL2ChainId: {
    [NetworkType.Mainnet]: undefined,
    [NetworkType.TestnetT10]: kasplexTestnet.id,
  },
  isLegacyEvmAddress: false,
} satisfies Settings;

export const SettingsContext = createContext<SettingsContextType>({
  settings: undefined,
  isSettingsLoading: true,
  setSettings: () => Promise.reject(new Error("Settings not loaded")),
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [localSettings, setLocalSettings] = useState<Settings>();

  useEffect(() => {
    const init = async () => {
      const settings = await storage.getItem<Settings>(SETTINGS_KEY, {
        fallback: initialSettings,
      });

      const mergedSetting = Object.assign(initialSettings, settings);

      setLocalSettings(mergedSetting);
      setIsSettingsLoading(false);
    };

    const listenSettings = (updatedSettings: Settings | null) => {
      if (updatedSettings) {
        setLocalSettings(updatedSettings);
      }
    };

    init();

    const unwatch = storage.watch(SETTINGS_KEY, listenSettings);

    return () => unwatch();
  }, []);

  const setSettings = async (
    newSettings: Settings | ((prev: Settings) => Settings),
  ) => {
    try {
      const valueToStore =
        newSettings instanceof Function
          ? newSettings(localSettings ?? ({} as Settings))
          : newSettings;

      await storage.setItem(SETTINGS_KEY, valueToStore);
      setLocalSettings(valueToStore);
    } catch (error) {
      captureException(error);
      console.error(`Error writing settings:`, error);
      throw error;
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        settings: localSettings,
        setSettings,
        isSettingsLoading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
