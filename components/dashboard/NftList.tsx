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
  const { data, size, setSize, isLoading } = useKRC721ByAddress(address);
  const {
    data: erc721Data,
    size: erc721Size,
    setSize: setErc721Size,
    isLoading: isErc721Loading,
    hasNextPage: hasErc721NextPage,
  } = useErc721AssetsFromApi();
  const [pagingErc721, setPagingErc721] = useState(false);
  const observerRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);

  const krc721HasNextPage = data && data[size - 1]?.next;
  const hasNextPage = pagingErc721
    ? hasErc721NextPage
    : krc721HasNextPage || !pagingErc721;

  const isCurrentlyLoading = pagingErc721 ? isErc721Loading : isLoading;
  const firstLoading = !data && isLoading;

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
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (
          entry.isIntersecting &&
          hasNextPage &&
          !isCurrentlyLoading &&
          !isLoadingRef.current
        ) {
          loadMore();
        }
      },
      {
        rootMargin: "100px",
        threshold: 0.1,
      },
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [hasNextPage, isCurrentlyLoading, loadMore]);

  return (
    <>
      <div className="grid grid-cols-3 items-end gap-3 pb-4">
        {firstLoading &&
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-28 w-auto animate-pulse rounded-xl bg-daintree-800"
            />
          ))}

        {data?.map((page) =>
          page.result.map((krc721) => (
            <KRC721Item
              key={`${krc721.tick}-${krc721.tokenId}`}
              tick={krc721.tick}
              tokenId={krc721.tokenId}
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
