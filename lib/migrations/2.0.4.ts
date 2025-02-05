import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";

export default async function handler() {
  const settings = await storage.getItem<Settings>(SETTINGS_KEY);
  if (!settings) {
    return;
  }

  if (!settings.lockTimeout) {
    settings.lockTimeout = 5;
  }

  await storage.setItem(SETTINGS_KEY, settings);
}
