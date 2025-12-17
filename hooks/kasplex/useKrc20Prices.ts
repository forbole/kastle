import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import useKaspaBalance from "../wallet/useKaspaBalance";

export interface PriceHistoryData {
  date: string;
  price: number;
}

export interface PriceHistoryResponse {
  data: PriceHistoryData[];
}

export interface TokenPriceData {
  currentPrice: number;
  lastPrice: number;
}

const baseUrl = "https://api.kaspa.com/krc20";

/**
 * Hook to fetch token price history and extract current and last day prices
 * @param ticker - The token ticker symbol
 * @param timeFrame - The time frame for price history (default: "1d")
 * @returns SWR response with current and last day price data
 */
export default function useKrc20Prices(
  ticker?: string,
  timeFrame: string = "1d",
) {
  const { kaspaPrice } = useKaspaPrice();
  const {
    data: rawData,
    error,
    isLoading,
    mutate,
  } = useSWR<PriceHistoryResponse, Error>(
    ticker
      ? `${baseUrl}/price-history-v2/${ticker}?timeFrame=${timeFrame}`
      : null,
    fetcher,
    { suspense: false },
  );

  const priceData: TokenPriceData | undefined = rawData?.data
    ? {
        currentPrice:
          (rawData.data[rawData.data.length - 1]?.price ?? 0) * kaspaPrice,
        lastPrice: (rawData.data[0]?.price ?? 0) * kaspaPrice,
      }
    : undefined;

  return {
    price: priceData?.currentPrice,
    lastPrice: priceData?.lastPrice,
    error,
    isLoading,
    mutate,
  };
}
