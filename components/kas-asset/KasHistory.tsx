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
    return () => observer.disconnect();
  }, [hasNextPage, isLoadingMore, loadMore]);

  return (
    <div className="no-scrollbar mt-8 flex flex-col items-stretch gap-2 overflow-y-auto">
      {txs.map((data, index) => (
        <TokenHistoryItem
          key={index}
          inputs={data.inputs}
          outputs={data.outputs}
          txHash={data.txHash}
        />
      ))}
      {/* Infinite scroll trigger */}
      {hasNextPage && (
        <div ref={observerRef} className="flex justify-center py-4">
          {isLoadingMore ? (
            <span>Loading...</span>
          ) : (
            <span className="text-xs text-gray-400">
              Scroll to load more...
            </span>
          )}
        </div>
      )}
    </div>
  );
}
