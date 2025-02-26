import { NetworkType } from "@/contexts/SettingsContext.tsx";

export default async function handler() {
  const SETTINGS_KEY = "local:settings";
  const oldSettings =
    (await storage.getItem<
      {
        knsApiUrls: { [networkId: string]: string | undefined };
      } & Record<string, unknown>
    >(SETTINGS_KEY)) ?? {};

  const newSettings = {
    ...oldSettings,
    knsApiUrls: {
      [NetworkType.Mainnet]: "https://api.knsdomains.org/mainnet",
      [NetworkType.TestnetT10]: "https://api.knsdomains.org/t10",
      [NetworkType.TestnetT11]: "https://api.knsdomains.org/t11",
    },
  };

  await storage.setItem(SETTINGS_KEY, newSettings);
}
