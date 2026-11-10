import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKasTxHistory from "@/hooks/useKasTxHistory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import { NetworkType } from "@/contexts/SettingsContext";
import { toHistoryRecord } from "@/lib/history/from-kas";
import { HistoryList } from "@/ui/popup/history/HistoryList";

export default function KasHistory() {
  const { account } = useWalletManager();
  const address = account?.address;
  const { networkId } = useRpcClientStateful();
  const { kaspaPrice } = useKaspaPrice();
  const network = networkId ?? NetworkType.Mainnet;
  const {
    txs,
    error,
    isLoading,
    isLoadingMore,
    hasNextPage,
    loadMore,
    mutate,
  } = useKasTxHistory(address);

  // The shell has no top margin of its own; KasAsset renders this bare in the tab.
  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      <HistoryList
        records={
          address
            ? txs.map((tx) =>
                toHistoryRecord(tx, address, { network, usdPrice: kaspaPrice }),
              )
            : []
        }
        isLoading={isLoading}
        isLoadingMore={!!isLoadingMore}
        error={error ?? null}
        hasMore={!!hasNextPage}
        onLoadMore={loadMore}
        onRetry={() => mutate()}
      />
    </div>
  );
}
