import { createContext, ReactNode, useEffect, useState } from "react";
import { captureException } from "@sentry/react";

export const SETTINGS_KEY = "local:settings";

export enum NetworkType {
  Mainnet = "mainnet",
  TestnetT10 = "testnet-10",
  TestnetT11 = "testnet-11",
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
  lockTimeout: number;
  walletConnections: WalletConnections | undefined; // WalletId -> Account Index -> NetworkId -> WalletConnection[]
  hideBalances: boolean;
  preview: boolean;
};

type WalletConnections = {
  [walletId: string]: AccountConnectionsByNetwork;
};

type AccountConnectionsByNetwork = {
  [accountIndex: number]: NetworkConnections;
};

type NetworkConnections = {
  [networkId: string]: AccountConnection[];
};

type AccountConnection = {
  host: string;
  name?: string;
  icon?: string;
};

export const RPC_URLS = {
  [NetworkType.Mainnet]:
    "wss://ws-borsh-mainnet-kaspa-fullnode-direct.forbole.com/borsh",
  [NetworkType.TestnetT10]: "wss://ws.tn10.kaspa.forbole.com/borsh",
  [NetworkType.TestnetT11]: "wss://ws.tn11.kaspa.forbole.com/borsh",
};
export const KASPLEX_API_URLS = {
  [NetworkType.Mainnet]: "https://api.kasplex.org/v1",
  [NetworkType.TestnetT10]: "https://tn10api.kasplex.org/v1",
  [NetworkType.TestnetT11]: "https://tn11api.kasplex.org/v1",
};
export const KNS_API_URLS = {
  [NetworkType.Mainnet]: "https://api.knsdomains.org/mainnet",
  [NetworkType.TestnetT10]: "https://api.knsdomains.org/tn10",
  [NetworkType.TestnetT11]: "https://api.knsdomains.org/tn11",
};

const initialSettings = {
  networkId: NetworkType.Mainnet,
  lockTimeout: 5, // Save 5 minutes as default value
  walletConnections: undefined,
  hideBalances: true,
  preview: false,
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

      setLocalSettings(settings);
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
