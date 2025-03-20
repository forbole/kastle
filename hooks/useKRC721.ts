import {
  KRC721_API_URLS,
  KRC721_CACHE_URLS,
  NetworkType,
} from "@/contexts/SettingsContext";
import { fetcher, emptyFetcher } from "@/lib/utils";
import useSWR from "swr";

type KRC721ByAddressResponse = {
  message: string;
  result: KRC721Info[];
};

type KRC721Info = {
  tick: string;
  tokenId: string;
};

export function useKRC721ByAddress(address?: string, refreshInterval?: number) {
  const { networkId } = useRpcClientStateful();

  const krc721ApiUrl = KRC721_API_URLS[networkId ?? NetworkType.Mainnet];

  return useSWR<KRC721ByAddressResponse, Error>(
    `${krc721ApiUrl}/api/v1/krc721/${networkId}/address/${address}`,
    address && krc721ApiUrl ? fetcher : emptyFetcher,
    {
      refreshInterval,
    },
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
