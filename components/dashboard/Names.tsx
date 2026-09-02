import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import { useAssetsByAddress } from "@/hooks/kns/useKns";
import { useInsDomainsByAddress } from "@/hooks/ins/useIns";
import NameCard from "@/components/dashboard/NameCard";

export default function Names() {
  const navigate = useNavigate();
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

  // Decided on KNS alone — INS's 30s owner lookup must not hold the empty
  // state hostage. insDomains.length still self-corrects once INS resolves.
  const isEmpty =
    !knsFirstLoading &&
    insDomains.length === 0 &&
    (knsData?.[0]?.data?.assets?.length ?? 0) === 0;

  return (
    <div className="flex flex-wrap gap-[12px] pb-4">
      {isEmpty && (
        <div className="flex w-full justify-center py-6 text-sm text-daintree-400">
          No names found
        </div>
      )}

      {/* KNS domains */}
      {knsData?.flatMap((page) =>
        page.data.assets.map((asset) => (
          <NameCard
            key={asset.assetId}
            name={asset.asset}
            source="kas"
            isVerified={asset.isVerifiedDomain}
            onClick={() => navigate(`/kns/${asset.assetId}`)}
          />
        )),
      )}

      {/* INS domains */}
      {insDomains.map((name) => (
        // No isVerified: INS exposes no verification flag, so the badge must
        // stay absent rather than assert "verified" for every INS name.
        <NameCard
          key={name}
          name={name}
          source="igra"
          onClick={() => navigate(`/ins/${name}`)}
        />
      ))}

      {/* Placeholder cards, not a spinner: they sit in the grid flow so the
          row keeps its shape and nothing jumps as pages land. Rendered after
          the real cards, which puts them at the start on a first load (there
          are none yet) and at the end while a further page resolves. */}
      {(isKnsLoading || isInsLoading) &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={`skeleton-${index}`}
            // Announced once, on the first card only: the pair is one loading
            // state, not two things to read out.
            {...(index === 0 && { role: "status", "aria-label": "loading" })}
            className="h-[120px] w-[104px] shrink-0 animate-pulse rounded-[12px] border border-daintree-700 bg-daintree-800"
          />
        ))}

      <div ref={sentinelRef} className="h-1 w-full" />
    </div>
  );
}
