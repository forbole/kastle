import {
  KRC721_CACHE_URLS,
  KRC721_INDEXER_URLS,
  NetworkType,
} from "@/contexts/SettingsContext";
import { fetcher } from "@/lib/utils";
import {
  convertIPFStoHTTP,
  fetchImmutable,
  fetchIPFSMetadata,
} from "@/lib/cache/ipfsCache";
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

// kaspa.com's cache: `/thumbnail` and `/optimized` images, `/metadata` JSON.
export function useKRC721CacheBase() {
  const { networkId } = useRpcClientStateful();
  return KRC721_CACHE_URLS[networkId ?? NetworkType.Mainnet];
}

// The cache answers a burst from one client with 429s (measured: 16 of 50 at
// once, then 49 of the next 50; 0 of 50 at five in flight), so every request
// to it, grid thumbnail or detail metadata, takes one of five slots. Slots
// are granted in request order, i.e. grid order.
// ponytail: same shape as mobile's KRC721_CACHE_MAX_IN_FLIGHT limiter.
const CACHE_MAX_IN_FLIGHT = 5;
let inFlight = 0;
const waiters: (() => void)[] = [];

// Calls `grant` once a slot is free. The returned function gives the slot
// back, or withdraws a request that was never granted; calling it again is
// a no-op.
export function requestCacheSlot(grant: () => void) {
  let held = false;
  const take = () => {
    held = true;
    grant();
  };
  if (inFlight < CACHE_MAX_IN_FLIGHT) {
    inFlight += 1;
    take();
  } else waiters.push(take);
  return () => {
    const i = waiters.indexOf(take);
    if (i >= 0) waiters.splice(i, 1);
    if (!held) return;
    held = false;
    const next = waiters.shift();
    if (next) next();
    else inFlight -= 1;
  };
}

// A token the cache cannot resolve is answered with a 400, or by never
// answering at all (mobile's note), so the IPFS fallback needs a deadline.
// Mobile's is 15 s too.
const CACHE_METADATA_DEADLINE_MS = 15_000;

async function fetchCacheMetadata<T>(url: string): Promise<T> {
  let release = () => {};
  await new Promise<void>((resolve) => {
    release = requestCacheSlot(resolve);
  });
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(CACHE_METADATA_DEADLINE_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return (await res.json()) as T;
  } finally {
    release();
  }
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

// Detail screen and transfer flow arrive with only tick/tokenId in the route.
// Mobile's order: kaspa.com's cache first (0.3 s where Pinata took minutes to
// 404 or 429), then IPFS, whose buri comes from the (immutably cached)
// collection lookup.
export function useKRC721Details(
  ticker?: string,
  tokenID?: string,
  refreshInterval?: number,
) {
  const { networkId } = useRpcClientStateful();
  const cacheBase = useKRC721CacheBase();

  return useSWR<KRC721DetailsResponse, Error>(
    ticker && tokenID
      ? [
          `${indexerBase(networkId)}/api/v1/krc721/${networkId ?? NetworkType.Mainnet}/nfts/${ticker}`,
          tokenID,
          `${cacheBase}/metadata/${ticker}/${tokenID}`,
        ]
      : null,
    async ([url, id, cacheUrl]: [string, string, string]) => {
      try {
        return await fetchCacheMetadata<KRC721DetailsResponse>(cacheUrl);
      } catch {
        const collectionData: KRC721CollectionResponse =
          await fetchImmutable(url);
        const buri = collectionData?.result?.buri;
        // Nothing left to try. Resolving empty would read as "still loading".
        if (!buri) throw new Error(`No buri for ${url}`);
        return fetchIPFSMetadata<KRC721DetailsResponse>(buri, id);
      }
    },
    {
      refreshInterval,
    },
  );
}

// The artwork: the cache's `/optimized` render first, which needs no
// metadata, and the metadata's IPFS image only if that errors.
export function useKRC721Image(
  tick?: string,
  tokenId?: string,
  ipfsImage?: string,
) {
  const cacheSrc = `${useKRC721CacheBase()}/optimized/${tick}/${tokenId}`;
  // Keyed to the URL, so another token or network tries its cache again.
  const [failedSrc, setFailedSrc] = useState<string>();
  return {
    src:
      failedSrc === cacheSrc
        ? ipfsImage && convertIPFStoHTTP(ipfsImage)
        : cacheSrc,
    onError: () => setFailedSrc(cacheSrc),
  };
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
