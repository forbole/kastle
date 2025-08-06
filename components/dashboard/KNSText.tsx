import React from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useAssetsByAddress } from "@/hooks/useKns.ts";
import KNSTextItem from "@/components/dashboard/KNSTextItem.tsx";

export default function KNSText() {
  const { account } = useWalletManager();
  const { data, size, setSize, isLoading } = useAssetsByAddress(
    "text",
    account?.address ?? "",
  );

  const pagination = data && data[size - 1]?.data?.pagination;
  const hasNextPage =
    pagination && pagination.currentPage < pagination.totalPages;
  const firstLoading = !data && isLoading;
  return (
    <div className="space-y-2 pb-4">
      {firstLoading &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[72px] animate-pulse cursor-pointer rounded-xl border border-daintree-700 bg-daintree-800 p-3"
          />
        ))}
      {data?.flatMap((asset) =>
        asset.data.assets.flatMap((asset) => (
          <KNSTextItem key={asset.assetId} asset={asset} />
        )),
      )}

      {/* Load more button */}
      {hasNextPage && (
        <button
          onClick={() => {
            if (isLoading) return;
            setSize(size + 1);
          }}
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
    </div>
  );
}
