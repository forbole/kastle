import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useKRC721ByAddress } from "@/hooks/krc721/useKRC721";
import KRC721Item from "@/components/dashboard/KRC721Item";
import useErc721AssetsFromApi from "@/hooks/evm/useErc721AssetsFromApi";
import { useState } from "react";
import ERC721Item from "./Erc721Item";

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

  const krc721HasNextPage = data && data[size - 1]?.next;
  const hasNextPage = hasErc721NextPage || krc721HasNextPage;

  const firstLoading = !data && isLoading;

  const loadMore = () => {
    switch (pagingErc721) {
      case true:
        if (isErc721Loading) return;
        setErc721Size(erc721Size + 1);
        break;
      case false:
        if (isLoading) return;

        if (krc721HasNextPage) setSize(size + 1);
        else setPagingErc721(true);
        break;
    }
  };

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
                chainId={page.chainId}
                asset={asset}
              />
            )),
          )}
      </div>

      {/* Load more button */}
      {hasNextPage && (
        <button
          onClick={loadMore}
          className="mb-4 mt-4 w-full rounded-lg bg-[#102832] py-2 text-white hover:bg-[#3B6273]"
        >
          {isLoading ? (
            <div
              className="inline-block size-6 animate-spin self-center rounded-full border-[6px] border-current border-t-[#A2F5FF] text-icy-blue-600"
              role="status"
              aria-label="loading"
            />
          ) : (
            "Load More"
          )}
        </button>
      )}
    </>
  );
}
