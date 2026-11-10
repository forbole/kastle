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

const decimalsOf = (dec: unknown) => {
  const n = Number(dec);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

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
    isValidating,
    error,
    mutate,
  } = useOpListByAddressAndTicker(
    ticker && ownAddress ? { ticker, address: ownAddress } : undefined,
  );

  const tokenInfo = tokenInfoResponse?.result?.[0];
  const ctx = {
    ownAddress: ownAddress ?? "",
    // Never the route param: for issue-mode tokens it is a contract address.
    tick: tokenInfo?.tick ?? tokenInfo?.name ?? "",
    // dec is a string from Kasplex; anything but a positive integer is
    // unknown, and the adapter falls back to base units.
    decimals: decimalsOf(tokenInfo?.dec),
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
        key={`${ownAddress}:${ticker}`}
        records={records}
        isLoading={isLoading && !opList}
        isLoadingMore={isValidating && !!opList?.length}
        error={error ?? null}
        hasMore={!finished}
        onLoadMore={() => setSize((prev) => prev + 1)}
        onRetry={() => mutate()}
      />
    </div>
  );
}

export default TokenHistory;
