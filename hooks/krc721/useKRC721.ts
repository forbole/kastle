import {
  KRC721_API_URLS,
  KRC721_CACHE_URLS,
  NetworkType,
} from "@/contexts/SettingsContext";
import { fetcher, emptyFetcher } from "@/lib/utils";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

type KRC721ByAddressResponse = {
  message: string;
  result: KRC721Info[];
  next?: string;
};

type KRC721Info = {
  tick: string;
  tokenId: string;
};

export function useKRC721ByAddress(address?: string) {
  const { networkId } = useRpcClientStateful();

  const krc721ApiUrl = KRC721_API_URLS[networkId ?? NetworkType.Mainnet];

  const getKey = (
    pageIndex: number,
    previousPageData: KRC721ByAddressResponse,
  ) => {
    if (pageIndex === 0)
      return `${krc721ApiUrl}/api/v1/krc721/${networkId}/address/${address}`;
    if (!previousPageData?.next) return null;
    return `${krc721ApiUrl}/api/v1/krc721/${networkId}/address/${address}?offset=${previousPageData.next}`;
  };

  return useSWRInfinite<KRC721ByAddressResponse, Error>(
    getKey,
    address ? fetcher : emptyFetcher,
  );
}

type KRC721DetailsResponse = {
  image: string;
  name: string;
  attributes: Attribute[];
  description: string;
};

type Attribute = {
  trait_type: string;
  value: string;
};

export function useKRC721Details(
  ticker?: string,
  tokenID?: string,
  refreshInterval?: number,
) {
  const { networkId } = useRpcClientStateful();

  const krc721CacheURL = KRC721_CACHE_URLS[networkId ?? NetworkType.Mainnet];

  return useSWR<KRC721DetailsResponse, Error>(
    `${krc721CacheURL}/metadata/${ticker}/${tokenID}`,
    ticker && tokenID && krc721CacheURL ? fetcher : emptyFetcher,
    {
      refreshInterval,
    },
  );
}
