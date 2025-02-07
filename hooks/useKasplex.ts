import { useSettings } from "@/hooks/useSettings.ts";

export type TickerInfo = {
  state: string;
  lim: string;
  dec: string;
  max: string;
  minted: string;
};

export type TickerInfoResponse = {
  result: TickerInfo[];
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

export interface Op {
  p: string;
  op: string;
  tick: string;
  amt: string;
  pre: string;
  from: string;
  to?: string;
  opScore: string;
  hashRev: string;
  feeRev: string;
  txAccept: string;
  opAccept: string;
  opError: string;
  checkpoint: string;
  mtsAdd: string;
  mtsMod: string;
  price?: string;
  utxo?: string;
}

export interface OpListResponse {
  message: string;
  prev: string;
  next: string;
  result: Op[];
}

export function useKasplex() {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  const fetchTokenInfo = async (ticker: string) => {
    const response = await fetch(`${kasplexUrl}/krc20/token/${ticker}`);
    return (await response.json()) as TickerInfoResponse | undefined;
  };

  const fetchTokenListByAddress = async (address: string) => {
    const response = await fetch(
      `${kasplexUrl}/krc20/address/${address}/tokenlist`,
    );
    return (await response.json()) as TokenListResponse | undefined;
  };

  const fetchOpListByAddressAndTicker = async (
    address: string,
    ticker: string,
  ) => {
    const response = await fetch(
      `${kasplexUrl}/krc20/oplist?address=${address}&tick=${ticker}`,
    );
    return (await response.json()) as OpListResponse | undefined;
  };

  return {
    kasplexUrl,
    fetchTokenInfo,
    fetchTokenListByAddress,
    fetchOpListByAddressAndTicker,
  };
}
