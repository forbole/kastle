import { useSettings } from "@/hooks/useSettings.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export type TokenInfo = {
  ca?: string;
  name?: string;
  tick?: string;

  mod: "mint" | "issue";
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

export type TokenInfoResponse = {
  result: TokenInfo[];
};

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  const fetchTokenInfo = async (id: string) => {
    const response = await fetch(`${kasplexUrl}/krc20/token/${id}`);
    return (await response.json()) as TokenInfoResponse | undefined;
  };

  return { fetchTokenInfo };
}
