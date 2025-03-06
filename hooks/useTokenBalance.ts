import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

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

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  return useSWR<TokenBalanceResponse, Error>(
    kasplexUrl && params
      ? `${kasplexUrl}/krc20/address/${params.address}/token/${params.ticker}`
      : null,
    fetcher,
  );
}
