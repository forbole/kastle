import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings.ts";

export type TokenBalanceResponse = {
  message: string;
  result: Result[];
};

export type Result = {
  tick: string;
  balance: string;
  locked: string;
  dec: string;
  opScoreMod: string;
};

export function useTokenBalance(
  params: { address: string; ticker: string } | undefined,
) {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  return useSWR<TokenBalanceResponse, Error>(
    kasplexUrl && params
      ? `${kasplexUrl}/krc20/address/${params.address}/token/${params.ticker}`
      : null,
    fetcher,
  );
}
