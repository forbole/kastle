import React from "react";
import { useParams } from "react-router-dom";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import {
  Op,
  useOpListByAddressAndTicker,
} from "@/hooks/useOpListByAddressAndTicker";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { useKrc20Prices } from "@/hooks/kasplex/useKrc20Prices";
import { NetworkType } from "@/contexts/SettingsContext";
import { toHistoryRecord } from "@/lib/history/from-krc20";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import type { HistoryRecord } from "@/lib/history/types";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";

// Validate the raw value: Number("") and Number(null) are 0 too, but a real
// "0" is an integer token and keeps its ticker and fiat.
const decimalsOf = (dec: unknown) =>
  /^\d+$/.test(String(dec)) ? Number(dec) : undefined;

export function TokenHistory() {
  const { ticker } = useParams();
  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const { account } = useWalletManager();
  const { networkId } = useRpcClientStateful();
  const { price } = useKrc20Prices(ticker);
  const { logo } = useKrc20Logo(ticker);
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
    // dec is a string from Kasplex; anything but a non-negative integer is
    // unknown, and the adapter falls back to base units.
    decimals: decimalsOf(tokenInfo?.dec),
    network: (networkId ?? NetworkType.Mainnet) as NetworkType,
    usdPrice: price,
  };
  const ops =
    opList?.flatMap(
      (page) => page.result?.filter((op) => op.opAccept === "1") ?? [],
    ) ?? [];
  const records = ops.map((op) => toHistoryRecord(op, ctx));
  const opById = new Map<string, Op>(
    records.map((record, i) => [record.id, ops[i]]),
  );

  // Commit and reveal are two transactions. Kasplex indexes an op from its
  // reveal (hashRev), which spends the commit output, so an indexed reveal
  // means a confirmed commit; txAccept says whether the reveal itself landed.
  const getRowExtras = (record: HistoryRecord) => {
    const op = opById.get(record.id);
    const isCommitted = !!op?.hashRev;
    const isRevealed = op?.txAccept === "1";
    return {
      logo: logo ?? kasIcon,
      chainBadge: kasIcon,
      txCount: isCommitted && isRevealed ? 2 : 1,
      isSymbolHidden: true,
      hashSteps: [
        { label: "Committed", isDone: isCommitted },
        {
          label: "Revealed",
          isDone: isRevealed,
          href: record.explorer?.url,
        },
      ],
    };
  };
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
        getRowExtras={getRowExtras}
      />
    </div>
  );
}

export default TokenHistory;
