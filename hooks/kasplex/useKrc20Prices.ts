import useSWR from "swr";
import { fetcher, multiFetcher } from "@/lib/utils";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import { applyDecimal } from "@/lib/krc20";

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

export interface TokenBalanceData {
  id: string;
  balance: string;
  dec: string;
}

type FloorPriceResponse = FloorPriceData[];

interface FloorPriceData {
  ticker: string;
  floor_price: number;
}

const baseApiUrl = "https://api.kaspa.com";
const krc20BaseUrl = `${baseApiUrl}/krc20`;
const floorPriceBaseUrl = `${baseApiUrl}/p2p-data/floor-price`;

/**
 * Hook to fetch token price history and extract current and last day prices
 * @param ticker - The token ticker symbol
 * @returns SWR response with current and last day price data
 */
export function useKrc20Prices(ticker?: string) {
  const { kaspaPrice } = useKaspaPrice();
  const {
    data: rawData,
    error,
    isLoading,
    mutate,
  } = useSWR<PriceHistoryResponse, Error>(
    ticker ? `${krc20BaseUrl}/price-history-v2/${ticker}?timeFrame=1h` : null,
    fetcher,
    { suspense: false },
  );
  const { data: floorPriceData } = useSWR<FloorPriceResponse, Error>(
    ticker ? `${floorPriceBaseUrl}?ticker=${ticker}` : null,
    fetcher,
    { suspense: false },
  );

  const priceDataInKas: TokenPriceData | undefined = rawData?.data
    ? {
        currentPrice: rawData.data[rawData.data.length - 1]?.price ?? 0,
        lastPrice: rawData.data[0]?.price ?? 0,
      }
    : undefined;

  const currentPriceInKas =
    priceDataInKas?.currentPrice && priceDataInKas.currentPrice > 0
      ? priceDataInKas.currentPrice
      : floorPriceData?.[0]?.floor_price;

  return {
    price: currentPriceInKas ? currentPriceInKas * kaspaPrice : undefined,
    error,
    isLoading,
    mutate,
  };
}

/**
 * Hook to get current USD prices for given KRC20 token IDs with balances
 * @param tokens - Array of token data with id, balance, and decimal
 * @returns Current price information in USD for all tokens
 */
export function useKrc20TotalPriceInUsd(tokens?: TokenBalanceData[]) {
  const { kaspaPrice } = useKaspaPrice();
  const urls = tokens
    ?.map((token) =>
      token.id
        ? `${krc20BaseUrl}/price-history-v2/${token.id}?timeFrame=1h`
        : null,
    )
    .filter(Boolean) as string[];

  const { data, error, isLoading, mutate } = useSWR<
    PriceHistoryResponse[],
    Error
  >(urls && urls.length > 0 ? urls : null, multiFetcher, {
    suspense: false,
  });

  const floorPriceUrls = tokens
    ?.map((token) =>
      token.id ? `${floorPriceBaseUrl}?ticker=${token.id}` : null,
    )
    .filter(Boolean) as string[];

  const { data: floorPriceData } = useSWR<FloorPriceResponse, Error>(
    floorPriceUrls && floorPriceUrls.length > 0 ? floorPriceUrls : null,
    multiFetcher,
    { suspense: false },
  );

  const totalUsd =
    tokens?.reduce<number>((acc, token, index) => {
      const response = data?.[index];
      const priceFromHistory =
        response?.data?.[response.data.length - 1]?.price;
      const currentPriceInKas =
        priceFromHistory && priceFromHistory > 0
          ? priceFromHistory
          : (floorPriceData?.[index]?.floor_price ?? 0);
      const priceInUsd = currentPriceInKas * kaspaPrice;

      const { toFloat } = applyDecimal(token.dec);
      const balanceFloat = toFloat(parseInt(token.balance, 10));

      return acc + balanceFloat * priceInUsd;
    }, 0) ?? 0;

  return {
    totalUsd,
    error,
    isLoading,
    mutate,
  };
}

/**
 * Hook to get last day USD prices for given KRC20 token IDs with balances
 * @param tokens - Array of token data with id, balance, and decimal
 * @returns Last day price information in USD for all tokens
 */
export function useKrc20TotalPriceInUsdLastDay(tokens?: TokenBalanceData[]) {
  const { kaspaPrice } = useKaspaPrice();
  const urls = tokens
    ?.map((token) =>
      token.id
        ? `${krc20BaseUrl}/price-history-v2/${token.id}?timeFrame=1d`
        : null,
    )
    .filter(Boolean) as string[];

  const { data, error, isLoading, mutate } = useSWR<
    PriceHistoryResponse[],
    Error
  >(urls && urls.length > 0 ? urls : null, multiFetcher, {
    suspense: false,
  });

  const floorPriceUrls = tokens
    ?.map((token) =>
      token.id ? `${floorPriceBaseUrl}?ticker=${token.id}` : null,
    )
    .filter(Boolean) as string[];

  const { data: floorPriceData } = useSWR<FloorPriceResponse, Error>(
    floorPriceUrls && floorPriceUrls.length > 0 ? floorPriceUrls : null,
    multiFetcher,
    { suspense: false },
  );

  const totalUsd =
    tokens?.reduce<number>((acc, token, index) => {
      const response = data?.[index];
      const priceFromHistory = response?.data?.[0]?.price;
      const lastDayPriceInKas =
        priceFromHistory && priceFromHistory > 0
          ? priceFromHistory
          : (floorPriceData?.[index]?.floor_price ?? 0);
      const priceInUsd = lastDayPriceInKas * kaspaPrice;

      const { toFloat } = applyDecimal(token.dec);
      const balanceFloat = toFloat(parseInt(token.balance, 10));

      return acc + balanceFloat * priceInUsd;
    }, 0) ?? 0;

  return {
    totalUsd,
    error,
    isLoading,
    mutate,
  };
}
