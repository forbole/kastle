import { useEffect, useRef } from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import { useAssetsByAddress } from "@/hooks/kns/useKns";
import { useInsDomainsByAddress } from "@/hooks/ins/useIns";
import KNSItem from "@/components/dashboard/KNSItem.tsx";
import INSItem from "@/components/dashboard/INSItem";

export default function Names() {
  const { account } = useWalletManager();
  const evmAddress = useEvmAddress();

  const {
    data: knsData,
    size: knsSize,
    setSize: setKnsSize,
    isLoading: isKnsLoading,
  } = useAssetsByAddress("domain", account?.address ?? "");
  const { domains: insDomains, isLoading: isInsLoading } =
    useInsDomainsByAddress(evmAddress);

  const pagination = knsData && knsData[knsSize - 1]?.data?.pagination;
  const hasNextPage =
    pagination && pagination.currentPage < pagination.totalPages;
  const knsFirstLoading = !knsData && isKnsLoading;
  const insFirstLoading = !insDomains.length && isInsLoading;

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isKnsLoading) {
        setKnsSize((s) => s + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isKnsLoading, setKnsSize]);

  const isEmpty =
    !knsFirstLoading &&
    !insFirstLoading &&
    insDomains.length === 0 &&
    (knsData?.[0]?.data?.assets?.length ?? 0) === 0;

  return (
    <div className="space-y-2 pb-4">
      {isEmpty && (
        <div className="flex justify-center py-6 text-sm text-daintree-400">
          No names found
        </div>
      )}

      {/* KNS domains */}
      {knsFirstLoading &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[72px] animate-pulse cursor-pointer rounded-xl border border-daintree-700 bg-daintree-800 p-3"
          />
        ))}

      {knsData?.flatMap((page) =>
        page.data.assets.map((asset) => (
          <KNSItem key={asset.assetId} asset={asset} />
        )),
      )}

      {/* INS domains */}
      {insFirstLoading &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[72px] animate-pulse cursor-pointer rounded-xl border border-daintree-700 bg-daintree-800 p-3"
          />
        ))}

      {insDomains.map((name) => (
        <INSItem key={name} name={name} />
      ))}

      <div ref={sentinelRef} className="h-1" />

      {isKnsLoading && !knsFirstLoading && (
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
