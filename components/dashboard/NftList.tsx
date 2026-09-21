import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useKRC721ByAddress } from "@/hooks/krc721/useKRC721";
import KRC721Item from "@/components/dashboard/KRC721Item";
import useErc721AssetsFromApi from "@/hooks/evm/useErc721AssetsFromApi";
import { useState, useEffect, useRef, useCallback } from "react";
import ERC721Item from "./Erc721Item";
import { Hex } from "viem";

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

  // Same split as the Names tab: a failed fetch is not an empty wallet, so the
  // two messages stay separate, the error takes precedence, and neither shows
  // over cards that did land.
  const failed = !!error || !!erc721Error;
  const nothingRendered =
    !isLoading &&
    !isErc721Loading &&
    (data?.[0]?.result?.length ?? 0) === 0 &&
    (erc721Data?.[0]?.items?.length ?? 0) === 0;

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
  }, [hasNextPage]);

  return (
    <>
      {failed && nothingRendered && (
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

        {pagingErc721 &&
          erc721Data?.map((page) =>
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
