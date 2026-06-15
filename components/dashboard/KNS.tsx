import { useEffect, useRef } from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useAssetsByAddress } from "@/hooks/kns/useKns";
import KNSItem from "@/components/dashboard/KNSItem.tsx";

export default function KNS() {
  const { account } = useWalletManager();
  const { data, size, setSize, isLoading } = useAssetsByAddress(
    "domain",
    account?.address ?? "",
  );

  const pagination = data && data[size - 1]?.data?.pagination;
  const hasNextPage =
    pagination && pagination.currentPage < pagination.totalPages;
  const firstLoading = !data && isLoading;

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isLoading) {
        setSize((s) => s + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isLoading, setSize]);

  return (
    <div className="space-y-2 pb-4">
      {firstLoading &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[72px] animate-pulse cursor-pointer rounded-xl border border-daintree-700 bg-daintree-800 p-3"
          />
        ))}

      {data?.flatMap((page) =>
        page.data.assets.map((asset) => (
          <KNSItem key={asset.assetId} asset={asset} />
        )),
      )}

      <div ref={sentinelRef} className="h-1" />

      {isLoading && !firstLoading && (
        <div className="flex justify-center py-2">
          <div
            className="inline-block size-6 animate-spin rounded-full border-[6px] border-current border-t-[#A2F5FF] text-icy-blue-600"
            role="status"
            aria-label="loading"
          />
        </div>
      )}
    </div>
  );
}
