import { NetworkType } from "@/contexts/SettingsContext.tsx";

export default async function handler() {
  const SETTINGS_KEY = "local:settings";
  const oldSettings =
    (await storage.getItem<
      {
        rpcUrls: { [networkId: string]: string | undefined };
      } & Record<string, unknown>
    >(SETTINGS_KEY)) ?? {};

  const newSettings = {
    ...oldSettings,
    rpcUrls: {
      [NetworkType.Mainnet]: "wss://ws.kaspa.forbole.com/borsh",
      [NetworkType.TestnetT10]: "wss://ws.tn10.kaspa.forbole.com/borsh",
      [NetworkType.TestnetT11]: "wss://ws.tn11.kaspa.forbole.com/borsh",
    },
  };

  await storage.setItem(SETTINGS_KEY, newSettings);
}
