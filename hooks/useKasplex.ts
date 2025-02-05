import { useSettings } from "@/hooks/useSettings.ts";

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  return { kasplexUrl };
}
