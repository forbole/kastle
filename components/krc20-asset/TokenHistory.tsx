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
import { CHAIN_BADGES } from "@/ui/popup/kcc20/AssetImage";

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
  // One walk builds each record and remembers its op, so the extras never
  // depend on record ids being unique.
  const opByRecord = new WeakMap<HistoryRecord, Op>();
  const records = ops.map((op) => {
    const record = toHistoryRecord(op, ctx);
    opByRecord.set(record, op);
    return record;
  });

  // Commit and reveal are two transactions. Kasplex indexes an op from its
  // reveal (hashRev), which spends the commit output, so a reveal hash proves
  // a confirmed commit; txAccept says whether the reveal itself landed. With
  // no hash nothing is on chain to count or prove, so the row claims neither.
  const getRowExtras = (record: HistoryRecord) => {
    const op = opByRecord.get(record);
    const isCommitted = !!op?.hashRev;
    const isRevealed = isCommitted && op?.txAccept === "1";
    return {
      logo,
      chainBadge: CHAIN_BADGES.kcc20,
      txCount: isCommitted ? (isRevealed ? 2 : 1) : undefined,
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
