import { SettingsContext } from "@/contexts/SettingsContext.tsx";

export function useSettings() {
  const { settings, setSettings, isSettingsLoading } =
    useContext(SettingsContext);

  return [settings, setSettings, isSettingsLoading] as const;
}
