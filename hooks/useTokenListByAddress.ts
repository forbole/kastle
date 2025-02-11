import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings.ts";

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

export function useTokenListByAddress(
  address?: string,
  refreshInterval?: number,
) {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  return useSWR<TokenListResponse, Error>(
    kasplexUrl && address
      ? `${kasplexUrl}/krc20/address/${address}/tokenlist`
      : null,
    fetcher,
    { refreshInterval },
  );
}
