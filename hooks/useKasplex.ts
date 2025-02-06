import { useSettings } from "@/hooks/useSettings.ts";

export type TickerInfo = {
  result: Array<{
    state: string;
    lim: string;
    dec: string;
    max: string;
    minted: string;
  }>;
};

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  const fetchTokenInfo = async (ticker: string) => {
    const response = await fetch(`${kasplexUrl}/krc20/token/${ticker}`);
    return (await response.json()) as TickerInfo | undefined;
  };

  return { kasplexUrl, fetchTokenInfo };
}
