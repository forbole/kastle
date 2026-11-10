import React from "react";
import { useParams } from "react-router-dom";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { useOpListByAddressAndTicker } from "@/hooks/useOpListByAddressAndTicker";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { useKrc20Prices } from "@/hooks/kasplex/useKrc20Prices";
import { NetworkType } from "@/contexts/SettingsContext";
import { toHistoryRecord } from "@/lib/history/from-krc20";
import { HistoryList } from "@/ui/popup/history/HistoryList";

export function TokenHistory() {
  const { ticker } = useParams();
  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const { account } = useWalletManager();
  const { networkId } = useRpcClientStateful();
  const { price } = useKrc20Prices(ticker);
  const ownAddress = account?.address;
  const {
    data: opList,
    setSize,
    isLoading,
    error,
    mutate,
  } = useOpListByAddressAndTicker(
    ticker && ownAddress ? { ticker, address: ownAddress } : undefined,
  );

  const tokenInfo = tokenInfoResponse?.result?.[0];
  const ctx = {
    ownAddress: ownAddress ?? "",
    tick: tokenInfo?.tick ?? ticker ?? "",
    // ponytail: dec is a string from Kasplex; garbage → 0.
    decimals: Number(tokenInfo?.dec) || 0,
    network: (networkId ?? NetworkType.Mainnet) as NetworkType,
    usdPrice: price,
  };
  const records =
    opList?.flatMap(
      (page) =>
        page.result
          ?.filter((op) => op.opAccept === "1")
          .map((op) => toHistoryRecord(op, ctx)) ?? [],
    ) ?? [];
  const finished = !!opList && opList[opList.length - 1]?.next === undefined;

  return (
    <div className="mt-8">
      <HistoryList
        records={records}
        isLoading={isLoading && !opList}
        isLoadingMore={isLoading && !!opList?.length}
        error={error ?? null}
        hasMore={!finished}
        onLoadMore={() => setSize((prev) => prev + 1)}
        onRetry={() => mutate()}
      />
    </div>
  );
}

export default TokenHistory;
