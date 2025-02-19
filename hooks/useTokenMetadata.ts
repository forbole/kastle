import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";

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

export function useTokenMetadata(ticker?: string) {
  const baseUrl = "https://api-v2-do.kas.fyi";

  const swrResponse = useSWR<TokenMetadata, Error>(
    ticker ? `${baseUrl}/token/krc20/${ticker}/info` : null,
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
