import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export type TokenListItem = {
  ca?: string;
  tick?: string;

  balance: string;
  locked: string;
  dec: string;
  opScoreMod: string;
};

export type TokenListResponse = {
  message: string;
  prev: string;
  next: string;
  result: TokenListItem[] | undefined;
};

export type TokenItem = {
  id: string;
  dec: string;
  balance: string;
};

export function useTokenListByAddress(
  address?: string,
  refreshInterval?: number,
) {
  const [settings] = useSettings();

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  const { data } = useSWR<TokenListResponse, Error>(
    kasplexUrl && address
      ? `${kasplexUrl}/krc20/address/${address}/tokenlist`
      : null,
    fetcher,
    { refreshInterval },
  );

  const tokenList = data?.result?.map((item) => {
    const { ca, tick, dec, balance } = item;
    return {
      id: tick ?? ca,
      dec,
      balance,
    } as TokenItem;
  });

  return tokenList;
}
