import { useRef, useEffect } from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import TokenHistoryItem from "./TokenHistoryItem";
import useKasTxHistory from "@/hooks/useKasTxHistory";

export default function KasHistory() {
  const { account } = useWalletManager();
  const address = account?.address;

  const { txs, isLoadingMore, hasNextPage, loadMore } =
    useKasTxHistory(address);

  const observerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasNextPage || isLoadingMore) return;
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "100px" },
    );
    if (observerRef.current) observer.observe(observerRef.current);
    return () => {
      if (observerRef.current) observer.unobserve(observerRef.current);
      observer.disconnect();
    };
  }, [hasNextPage, isLoadingMore, loadMore]);

  return (
    <div className="no-scrollbar mt-8 flex flex-col items-stretch gap-2 overflow-y-auto">
      {txs.map((data) => (
        <TokenHistoryItem
          key={data.txHash}
          inputs={data.inputs}
          outputs={data.outputs}
          txHash={data.txHash}
        />
      ))}
      {/* Infinite scroll trigger */}
      <div ref={observerRef} className="flex justify-center">
        {isLoadingMore && (
          <span
            className="inline-block size-6 animate-spin self-center rounded-full border-[6px] border-current border-t-[#A2F5FF] text-icy-blue-600"
            role="status"
            aria-label="loading"
          />
        )}
      </div>
    </div>
  );
}
