import { useSettings } from "@/hooks/useSettings.ts";
import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { TickerInfoResponse } from "@/hooks/useKasplex.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export function useTokenInfo(ticker?: string) {
  const [settings] = useSettings();

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  return useSWR<TickerInfoResponse, Error>(
    kasplexUrl && ticker ? `${kasplexUrl}/krc20/token/${ticker}` : null,
    fetcher,
  );
}
