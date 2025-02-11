import { useSettings } from "@/hooks/useSettings.ts";
import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { TickerInfoResponse } from "@/hooks/useKasplex.ts";

export function useTokenInfo(ticker?: string) {
  const [settings] = useSettings();

  const kasplexUrl = settings?.kasplexApiUrls[settings?.networkId];

  return useSWR<TickerInfoResponse, Error>(
    kasplexUrl && ticker ? `${kasplexUrl}/krc20/token/${ticker}` : null,
    fetcher,
  );
}
