import useSWR from "swr";
import { multiFetcher } from "@/lib/utils.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";

export interface PriceHistoryData {
  date: string;
  price: number;
}

export interface PriceHistoryResponse {
  data: PriceHistoryData[];
}

const baseUrl = "https://api.kaspa.com/krc20";

/**
 * Hook to get last day USD prices for given KRC20 token IDs
 * @param tokenIds - Array of token IDs
 * @returns Last day price information in USD for all tokens
 */
export function useKrc20TotalPriceInUsdLastDay(tokenIds?: string[]) {
  const { kaspaPrice } = useKaspaPrice();
  const urls = tokenIds
    ?.map((ticker) =>
      ticker ? `${baseUrl}/price-history-v2/${ticker}?timeFrame=1d` : null,
    )
    .filter(Boolean) as string[];

  const { data, error, isLoading, mutate } = useSWR<
    PriceHistoryResponse[],
    Error
  >(urls && urls.length > 0 ? urls : null, multiFetcher, {
    suspense: false,
  });

  const priceInUsdKasTicker = tokenIds?.reduce<Record<string, number>>(
    (acc, ticker, index) => {
      const response = data?.[index];
      const lastDayPrice = response?.data?.[0]?.price ?? 0;
      acc[ticker] = lastDayPrice;
      return acc;
    },
    {},
  );

  const totalUsd =
    Object.values(priceInUsdKasTicker ?? {}).reduce(
      (sum, price) => sum + price,
      0,
    ) * kaspaPrice;

  return {
    totalUsd,
    error,
    isLoading,
    mutate,
  };
}
