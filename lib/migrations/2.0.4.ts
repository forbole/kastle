import {
  NetworkType,
  Settings,
  SETTINGS_KEY,
} from "@/contexts/SettingsContext.tsx";

export default async function handler() {
  const settings = await storage.getItem<Settings>(SETTINGS_KEY);
  if (!settings) {
    return;
  }

  if (!settings.lockTimeout) {
    settings.lockTimeout = 5;
  }

  if (!settings.kasplexApiUrls) {
    settings.kasplexApiUrls = {
      [NetworkType.Mainnet]: "https://api.kasplex.org/v1",
      [NetworkType.TestnetT10]: "https://tn10api.kasplex.org/v1",
      [NetworkType.TestnetT11]: "https://tn11api.kasplex.org/v1",
    };
  }

  await storage.setItem(SETTINGS_KEY, settings);
}
