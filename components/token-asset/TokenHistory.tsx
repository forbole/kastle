import React from "react";
import { useParams } from "react-router-dom";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import TokenHistoryItem from "@/components/token-asset/TokenHistoryItem.tsx";
import { useOpListByAddressAndTicker } from "@/hooks/useOpListByAddressAndTicker.ts";

export default function TokenHistory() {
  const { ticker } = useParams();
  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const { account } = useWalletManager();
  const firstAddress = account?.address;
  const { data: opList } = useOpListByAddressAndTicker(
    ticker && firstAddress ? { ticker, address: firstAddress } : undefined,
  );
  const tickerInfo = tokenInfoResponse?.result?.[0];
  const filteredOpList =
    opList?.result?.filter((value) => value.opAccept === "1") ?? [];

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      {filteredOpList.map((op, index) => (
        <TokenHistoryItem key={index} tickerInfo={tickerInfo} op={op} />
      ))}
    </div>
  );
}
