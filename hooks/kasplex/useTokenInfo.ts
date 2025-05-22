import { useSettings } from "@/hooks/useSettings.ts";
import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { TokenInfoResponse } from "@/hooks/kasplex/useKasplex.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export function useTokenInfo(tokenId?: string) {
  const [settings] = useSettings();

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  return useSWR<TokenInfoResponse, Error>(
    kasplexUrl && tokenId ? `${kasplexUrl}/krc20/token/${tokenId}` : null,
    fetcher,
  );
}
