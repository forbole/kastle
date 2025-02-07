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

export type TokenListItem = {
  tick: string;
  balance: string;
  locked: string;
  dec: string;
  opScoreMod: string;
};

export type TokenListResponse = {
  message: string;
  prev: string;
  next: string;
  result: TokenListItem[];
};

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  const fetchTokenInfo = async (ticker: string) => {
    const response = await fetch(`${kasplexUrl}/krc20/token/${ticker}`);
    return (await response.json()) as TickerInfo | undefined;
  };

  const fetchTokenListByAddress = async (address: string) => {
    const response = await fetch(
      `${kasplexUrl}/krc20/address/${address}/tokenlist`,
    );
    return (await response.json()) as TokenListResponse | undefined;
  };

  return { kasplexUrl, fetchTokenInfo, fetchTokenListByAddress };
}
