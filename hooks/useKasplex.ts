import { useSettings } from "@/hooks/useSettings.ts";

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
};

export type TickerInfoResponse = {
  result: TickerInfo[];
};

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  const fetchTokenInfo = async (ticker: string) => {
    const response = await fetch(`${kasplexUrl}/krc20/token/${ticker}`);
    return (await response.json()) as TickerInfoResponse | undefined;
  };

  return { fetchTokenInfo };
}
