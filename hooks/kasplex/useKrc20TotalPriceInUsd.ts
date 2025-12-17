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
 * Hook to get USD prices for given KRC20 token IDs
 * @param tokenIds - Array of token IDs
 * @returns Price information in USD for all tokens
 */
export default function useKrc20TotalPriceInUsd(tokenIds?: string[]) {
  const { kaspaPrice } = useKaspaPrice();
  const urls = tokenIds
    ?.map((ticker) =>
      ticker ? `${baseUrl}/price-history-v2/${ticker}?timeFrame=1h` : null,
    )
    .filter(Boolean) as string[];

  const { data, error, isLoading, mutate } = useSWR<
    PriceHistoryResponse[],
    Error
  >(urls && urls.length > 0 ? urls : null, multiFetcher, {
    suspense: false,
  });

  const priceInKasPerTicker = tokenIds?.reduce<Record<string, number>>(
    (acc, ticker, index) => {
      const response = data?.[index];
      const currentPrice =
        response?.data?.[response.data.length - 1]?.price ?? 0;
      acc[ticker] = currentPrice;
      return acc;
    },
    {},
  );

  const totalUsd =
    Object.values(priceInKasPerTicker ?? {}).reduce(
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
