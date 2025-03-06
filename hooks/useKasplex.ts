import { useSettings } from "@/hooks/useSettings.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export type TickerInfo = {
  state: string;
  lim: string;
  dec: string;
  max: string;
  pre: string;
  minted: string;
  holderTotal: string;
  transferTotal: string;
  mintTotal: string;
  hashRev: string;
  mtsAdd: string;
};

export type TickerInfoResponse = {
  result: TickerInfo[];
};

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  const fetchTokenInfo = async (ticker: string) => {
    const response = await fetch(`${kasplexUrl}/krc20/token/${ticker}`);
    return (await response.json()) as TickerInfoResponse | undefined;
  };

  return { fetchTokenInfo };
}
