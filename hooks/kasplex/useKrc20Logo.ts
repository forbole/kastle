import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";

export interface TokenLogo {
  ticker: string;
  logo: string;
}

const baseUrl = "https://api.kaspa.com/api";

/**
 * Hook to fetch a single token logo by ticker
 * @param ticker - The token ticker symbol
 * @returns SWR response with token logo URL
 */
export default function useKrc20Logo(ticker?: string) {
  const {
    data: rawData,
    error,
    isLoading,
    mutate,
  } = useSWR<TokenLogo[], Error>(
    ticker ? `${baseUrl}/tokens-logos?ticker=${ticker}` : null,
    fetcher,
    { suspense: false },
  );

  const logo = rawData?.[0]?.logo;

  return {
    logo,
    error,
    isLoading,
    mutate,
  };
}
