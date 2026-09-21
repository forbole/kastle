import { KRC721_INDEXER_URLS, NetworkType } from "@/contexts/SettingsContext";
import { fetcher } from "@/lib/utils";
import { fetchImmutable, fetchIPFSMetadata } from "@/lib/cache/ipfsCache";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

type KRC721ByAddressResponse = {
  message: string;
  result?: KRC721Row[];
  next?: string;
};

// The address rows carry the collection's buri and the listing state (every
// row, measured), so the grid needs no per-token collection lookup. Both stay
// optional at the trust boundary.
export type KRC721Row = {
  tick: string;
  tokenId: string;
  buri?: string;
  status?: { state?: string };
};

function indexerBase(networkId?: NetworkType) {
  return KRC721_INDEXER_URLS[networkId ?? NetworkType.Mainnet];
}

export function useKRC721ByAddress(address?: string) {
  const { networkId } = useRpcClientStateful();
  const base = `${indexerBase(networkId)}/api/v1/krc721/${networkId ?? NetworkType.Mainnet}`;

  const getKey = (
    pageIndex: number,
    previousPageData: KRC721ByAddressResponse,
  ) => {
    if (!address) return null;
    if (pageIndex === 0) return `${base}/address/${address}`;
    if (!previousPageData?.next) return null;
    return `${base}/address/${address}?offset=${previousPageData.next}`;
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

// Grid cards: the row already has the buri, so this is the only request.
export function useKRC721Metadata(buri?: string, tokenId?: string) {
  return useSWR<KRC721DetailsResponse, Error>(
    buri && tokenId ? ["krc721-metadata", buri, tokenId] : null,
    ([, b, id]: [string, string, string]) =>
      fetchIPFSMetadata<KRC721DetailsResponse>(b, id),
  );
}

// Detail screen and transfer flow arrive with only tick/tokenId in the route,
// so the buri comes from the (immutably cached) collection lookup.
export function useKRC721Details(
  ticker?: string,
  tokenID?: string,
  refreshInterval?: number,
) {
  const { networkId } = useRpcClientStateful();

  return useSWR<KRC721DetailsResponse | undefined, Error>(
    ticker && tokenID
      ? [
          `${indexerBase(networkId)}/api/v1/krc721/${networkId ?? NetworkType.Mainnet}/nfts/${ticker}`,
          tokenID,
        ]
      : null,
    async ([url, id]: [string, string]) => {
      const collectionData: KRC721CollectionResponse =
        await fetchImmutable(url);
      const buri = collectionData?.result?.buri;
      if (!buri) return undefined;
      return fetchIPFSMetadata<KRC721DetailsResponse>(buri, id);
    },
    {
      refreshInterval,
    },
  );
}

type KRC721TokenResponse = {
  message: string;
  result?: {
    tick: string;
    tokenId: string;
    owner?: string;
    status?: { state?: string };
  };
};

// Owner and listing state are mutable, so this goes through the plain fetcher
// and SWR's normal revalidation, never the immutable cache.
export function useKRC721Token(ticker?: string, tokenID?: string) {
  const { networkId } = useRpcClientStateful();

  return useSWR<KRC721TokenResponse, Error>(
    ticker && tokenID
      ? `${indexerBase(networkId)}/api/v1/krc721/${networkId ?? NetworkType.Mainnet}/nfts/${ticker}/${tokenID}`
      : null,
    fetcher,
  );
}
