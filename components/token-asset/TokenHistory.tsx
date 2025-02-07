import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { Op, TickerInfo, useKasplex } from "@/hooks/useKasplex.ts";
import TokenHistoryItem from "@/components/token-asset/TokenHistoryItem.tsx";

export default function TokenHistory() {
  const { ticker } = useParams();
  const { fetchTokenInfo, fetchOpListByAddressAndTicker } = useKasplex();
  const { addresses } = useWalletManager();
  const [tickerInfo, setTickerInfo] = useState<TickerInfo>();
  const [opList, setOpList] = useState<Op[]>([]);

  const firstAddress = addresses[0];

  useEffect(() => {
    const fetchOps = async () => {
      if (!firstAddress || !ticker) {
        return;
      }
      const [tickerInfoResponse, opListResponse] = await Promise.all([
        await fetchTokenInfo(ticker),
        await fetchOpListByAddressAndTicker(firstAddress, ticker),
      ]);

      setTickerInfo(tickerInfoResponse?.result?.[0]);
      const unfilteredOps = opListResponse?.result ?? [];
      setOpList(unfilteredOps);
    };

    fetchOps();
  }, []);

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      {opList.map((op, index) => (
        <TokenHistoryItem key={index} tickerInfo={tickerInfo} op={op} />
      ))}
    </div>
  );
}
