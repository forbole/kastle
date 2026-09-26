import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useKRC721ByAddress } from "@/hooks/krc721/useKRC721";
import KRC721Item from "@/components/dashboard/KRC721Item";
import useErc721AssetsFromApi from "@/hooks/evm/useErc721AssetsFromApi";
import { useState, useEffect, useRef, useCallback } from "react";
import ERC721Item from "./Erc721Item";
import { Hex, hexToNumber } from "viem";
import { NftAsset } from "@/lib/nft/erc721";
import { INS_V1_REGISTRY, INS_V2_REGISTRY } from "@/lib/ins/insRegistry";
import { igraMainnet } from "@/lib/layer2";

// INS names are ERC-721s on these two registries, and they already have the
// Names tab. Filtered here, after the fetch, so the L2 pager is untouched.
const INS_REGISTRIES = new Set(
  [INS_V2_REGISTRY, INS_V1_REGISTRY].map((a) => a.toLowerCase()),
);
const isInsName = (chainId: string, asset: NftAsset) =>
  hexToNumber(chainId as Hex) === igraMainnet.id &&
  INS_REGISTRIES.has(asset.token.address_hash.toLowerCase());

export default function NftList() {
  const { account } = useWalletManager();
  const address = account?.address;
  const { data, size, setSize, isLoading, error, mutate } =
    useKRC721ByAddress(address);
  const {
    data: erc721Data,
    size: erc721Size,
    setSize: setErc721Size,
    isLoading: isErc721Loading,
    hasNextPage: hasErc721NextPage,
    error: erc721Error,
    mutate: mutateErc721,
  } = useErc721AssetsFromApi();
  const [pagingErc721, setPagingErc721] = useState(false);
  const observerRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);

  const krc721HasNextPage = data && data[size - 1]?.next;
  const hasNextPage = pagingErc721
    ? hasErc721NextPage
    : krc721HasNextPage || hasErc721NextPage;

  const isCurrentlyLoading = pagingErc721 ? isErc721Loading : isLoading;
  const firstLoading = !data && isLoading;
  // The L2 cards follow the last KRC-721 page. Not pagingErc721 alone: that
  // flag is component state and the L2 page count is SWR's, so after a
  // remount every L2 page can already be in, with no sentinel left to set it.
  const krc721Done =
    !!error || (!!data && data.length === size && !data[size - 1]?.next);
  const showErc721 = pagingErc721 || krc721Done;

  // Same split as the Names tab: a failed fetch is not an empty wallet, so the
  // two messages stay separate, the error takes precedence, and neither shows
  // over cards that did land.
  const failed = !!error || !!erc721Error;
  const erc721Pages = erc721Data?.map((page) => ({
    ...page,
    items: page.items.filter((asset) => !isInsName(page.chainId, asset)),
  }));
  // Counted from what the grid below actually draws -- every page of both
  // sources, ERC-721 only once it shows -- so neither message can sit above a
  // card. The empty one also waits until there is nothing left to page in;
  // the error does not, as a failed page leaves the pager thinking there is.
  const renderedCount =
    (data?.reduce((n, page) => n + (page.result?.length ?? 0), 0) ?? 0) +
    (showErc721
      ? (erc721Pages?.reduce((n, page) => n + page.items.length, 0) ?? 0)
      : 0);
  const settledEmpty = !isLoading && !isErc721Loading && renderedCount === 0;
  const nothingRendered = settledEmpty && !hasNextPage;

  const loadMore = useCallback(async () => {
    if (isLoadingRef.current || isCurrentlyLoading) return;

    isLoadingRef.current = true;
    try {
      if (pagingErc721) {
        if (!isErc721Loading && hasErc721NextPage) {
          setErc721Size(erc721Size + 1);
        }
      } else {
        if (krc721HasNextPage && !isLoading) {
          setSize(size + 1);
        } else if (!krc721HasNextPage) {
          setPagingErc721(true);
          if (hasErc721NextPage) {
            setErc721Size((prev) => prev + 1);
          }
        }
      }
    } finally {
      isLoadingRef.current = false;
    }
  }, [
    pagingErc721,
    isErc721Loading,
    isLoading,
    erc721Size,
    setErc721Size,
    krc721HasNextPage,
    size,
    setSize,
    hasErc721NextPage,
    isCurrentlyLoading,
  ]);

  // Intersection Observer for infinite scroll
  const hasNextPageRef = useRef(hasNextPage);
  hasNextPageRef.current = hasNextPage;
  const isCurrentlyLoadingRef = useRef(isCurrentlyLoading);
  isCurrentlyLoadingRef.current = isCurrentlyLoading;
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (
          entry.isIntersecting &&
          hasNextPageRef.current &&
          !isCurrentlyLoadingRef.current &&
          !isLoadingRef.current
        ) {
          loadMoreRef.current();
        }
      },
      {
        rootMargin: "100px",
        threshold: 0.1,
      },
    );

    const target = observerRef.current;
    if (target) {
      observer.observe(target);
    }

    return () => observer.disconnect();
    // Re-armed when a load settles too: observe() reports the sentinel's
    // current state, so a sentinel still on screen asks for the next page.
    // Keyed on hasNextPage alone, a first intersection that landed mid-load
    // was dropped and nothing re-fired it until the user scrolled.
  }, [hasNextPage, isCurrentlyLoading]);

  return (
    <>
      {failed && settledEmpty && (
        <div className="flex w-full flex-col items-center gap-2 py-6 text-center text-sm text-daintree-400">
          Couldn’t load your NFTs. Check your connection and try again.
          <button
            type="button"
            className="rounded-full border border-daintree-400 px-4 py-1 text-white"
            onClick={() => {
              mutate();
              mutateErc721();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!failed && nothingRendered && (
        <div className="flex w-full justify-center py-6 text-sm text-daintree-400">
          No NFTs found
        </div>
      )}

      <div className="grid grid-cols-3 items-end gap-3 pb-4">
        {firstLoading &&
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-28 w-auto animate-pulse rounded-xl bg-daintree-800"
            />
          ))}

        {data?.map((page) =>
          page.result?.map((krc721) => (
            <KRC721Item
              key={`${krc721.tick}-${krc721.tokenId}`}
              tick={krc721.tick}
              tokenId={krc721.tokenId}
              buri={krc721.buri}
            />
          )),
        )}

        {showErc721 &&
          erc721Pages?.map((page) =>
            page.items.map((asset) => (
              <ERC721Item
                key={`${page.chainId}-${asset.token.address_hash}-${asset.id}`}
                chainId={page.chainId as Hex}
                asset={asset}
              />
            )),
          )}
      </div>

      {/* Infinite scroll trigger */}
      {hasNextPage && (
        <div
          ref={observerRef}
          className="mb-4 mt-4 flex w-full justify-center py-4"
        >
          {isCurrentlyLoading ? (
            <div
              className="inline-block size-8 animate-spin self-center rounded-full border-[6px] border-current border-t-[#A2F5FF] text-icy-blue-600"
              role="status"
              aria-label="loading"
            />
          ) : (
            <div className="text-sm text-gray-400">Scroll to load more...</div>
          )}
        </div>
      )}
    </>
  );
}
