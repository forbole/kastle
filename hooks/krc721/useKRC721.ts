import {
  KRC721_INDEXER_BASE_URL,
  NetworkType,
} from "@/contexts/SettingsContext";
import { fetcher } from "@/lib/utils";
import { fetchImmutable, fetchIPFS } from "@/lib/cache/ipfsCache";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

type KRC721ByAddressResponse = {
  message: string;
  result?: KRC721Info[];
  next?: string;
};

type KRC721Info = {
  tick: string;
  tokenId: string;
};

export function useKRC721ByAddress(address?: string) {
  const { networkId } = useRpcClientStateful();

  const getKey = (
    pageIndex: number,
    previousPageData: KRC721ByAddressResponse,
  ) => {
    if (!address) return null;
    if (pageIndex === 0)
      return `${KRC721_INDEXER_BASE_URL}/api/v1/krc721/${networkId}/address/${address}`;
    if (!previousPageData?.next) return null;
    return `${KRC721_INDEXER_BASE_URL}/api/v1/krc721/${networkId}/address/${address}?offset=${previousPageData.next}`;
  };

  return useSWRInfinite<KRC721ByAddressResponse, Error>(getKey, fetcher);
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

type KRC721CollectionResponse = {
  message: string;
  result: {
    tick: string;
    buri: string;
  };
};

export function useKRC721Details(
  ticker?: string,
  tokenID?: string,
  refreshInterval?: number,
) {
  const { networkId } = useRpcClientStateful();

  return useSWR<KRC721DetailsResponse | undefined, Error>(
    ticker && tokenID
      ? [
          `${KRC721_INDEXER_BASE_URL}/api/v1/krc721/${networkId ?? NetworkType.Mainnet}/nfts/${ticker}`,
          tokenID,
        ]
      : null,
    async ([url, id]: [string, string]) => {
      const collectionData: KRC721CollectionResponse =
        await fetchImmutable(url);
      const buri = collectionData?.result?.buri;
      if (!buri) return undefined;
      return fetchIPFS<KRC721DetailsResponse>(`${buri}/${id}`);
    },
    {
      refreshInterval,
    },
  );
}
