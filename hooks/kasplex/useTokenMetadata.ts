import useSWR from "swr";
import { fetcher, multiFetcher } from "@/lib/utils.ts";

export interface TokenMetadata {
  ticker: string;
  maxSupply: number;
  preMint: number;
  mintLimit: number;
  decimal: number;
  totalMinted: number;
  opScoreCreated: number;
  opScoreUpdated: number;
  deployedAt: number;
  status: string;
  revealHash: string;
  holderTotal: number;
  transferTotal: number;
  mintTotal: number;
  deployerAddress: string;
  holders: Holder[];
  price?: Price;
  priceHistory: any[];
  priceCandles: any[];
  tradeVolume: TradeVolume;
  socialLinks: SocialLink[];
  iconUrl: string;
  marketsData: MarketsDaum[];
  burned: number;
  tradeEnabled: boolean;
  chaingeLpRate: number;
}

export interface Holder {
  address: string;
  amount: number;
  tags: Tag[];
}

export interface Tag {
  address: string;
  name: string;
  link: any;
  type: any;
}

export interface Price {
  floorPrice: number;
  priceInUsd: number;
  marketCapInUsd: number;
  change24h: number;
  change24hInKas: number;
}

export interface TradeVolume {
  amountInUsd: number;
}

export interface SocialLink {
  type: string;
  url: string;
}

export interface MarketsDaum {
  name: string;
  marketData: MarketData;
  metadata: Metadata;
  lastUpdated: number;
}

export interface MarketData {
  priceInUsd: number;
  volumeInUsd: number;
}

export interface Metadata {
  name: string;
  iconUrl: string;
  url: string;
  isKrc20Market?: boolean;
}

export interface TokenPriceCandles {
  candles: Candle[];
}

export interface Candle {
  ticker: string;
  close: number;
}

const baseUrl = "https://api-v2-do.kas.fyi";

const fetchUrls = async (urlString: string) => {
  // Split the string back into an array of URLs
  const urlArray = urlString.split(",");
  return Promise.all(urlArray.map((url) => fetcher(url)));
};

export function useTokenPrices(tokenIds?: string[]) {
  // Create an array of URLs instead of a comma-separated string
  const urls =
    tokenIds?.map(
      (id) => `${baseUrl}/token/krc20/${id}/charts?type=candles&interval=1d`,
    ) ?? [];

  // Call useSWR with a string key (comma-joined URLs)
  const { data: responses } = useSWR<TokenPriceCandles[], Error>(
    urls.length > 0 ? urls.join(",") : null,
    urls.length > 0 ? fetchUrls : null,
    { suspense: false },
  );

  // Process the results to map tickers to their prices
  const tokenPrices = tokenIds?.reduce(
    (acc, id, index) => {
      const response = responses?.[index];
      if (!response) {
        acc[id] = { lastDayPrice: 0, price: 0 };
        return acc;
      }

      const lastDayPrice = response.candles?.[0]?.close ?? 0;
      const candles = response.candles || [];
      const price =
        candles.length > 0 ? (candles[candles.length - 1]?.close ?? 0) : 0;

      acc[id] = { lastDayPrice, price };
      return acc;
    },
    {} as Record<string, { lastDayPrice: number; price: number }>,
  );

  return {
    tokenPrices,
  };
}

export function useTokenMetadata(tokenId?: string) {
  const swrResponse = useSWR<TokenMetadata, Error>(
    tokenId ? `${baseUrl}/token/krc20/${tokenId}/info` : null,
    fetcher,
  );

  const toPriceInUsd = () => {
    const getMarketAverage = () => {
      const marketDaum = swrResponse.data?.marketsData?.filter(
        (m) => m.marketData.priceInUsd !== 0,
      );
      const numberOfListings = marketDaum?.length ?? 0;

      if (numberOfListings === 0) {
        return 0;
      }

      const marketsSum =
        marketDaum?.reduce(
          (acc, cur) => acc + (cur?.marketData?.priceInUsd ?? 0),
          0,
        ) ?? 0;

      return marketsSum / numberOfListings;
    };

    return swrResponse.data?.price?.priceInUsd ?? getMarketAverage();
  };

  return { ...swrResponse, toPriceInUsd };
}

export function useTokensMetadata(tickers: string[]) {
  const urls = tickers
    .map((ticker) => (ticker ? `${baseUrl}/token/krc20/${ticker}/info` : null))
    .filter(Boolean);
  const swrResponse = useSWR<TokenMetadata[], Error>(urls, multiFetcher);

  const toPriceInUsd = () => {
    return swrResponse.data?.reduce<Record<string, number>>(
      (acc, tokenMetadata) => {
        const getMarketAverage = () => {
          const marketDaum = tokenMetadata?.marketsData?.filter(
            (m) => m.marketData.priceInUsd !== 0,
          );
          const numberOfListings = marketDaum?.length ?? 0;

          if (numberOfListings === 0) {
            return 0;
          }

          const marketsSum =
            marketDaum?.reduce(
              (acc, cur) => acc + (cur?.marketData?.priceInUsd ?? 0),
              0,
            ) ?? 0;

          return marketsSum / numberOfListings;
        };

        acc[tokenMetadata.ticker] =
          tokenMetadata?.price?.priceInUsd ?? getMarketAverage();
        return acc;
      },
      {},
    );
  };

  return { ...swrResponse, toPriceInUsd };
}
