import React from "react";
import { useParams } from "react-router-dom";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import TokenHistoryItem from "@/components/krc20-asset/TokenHistoryItem";
import { useOpListByAddressAndTicker } from "@/hooks/useOpListByAddressAndTicker.ts";
import { useIntersectionObserver } from "usehooks-ts";
import useWalletManager from "@/hooks/wallet/useWalletManager.ts";

export default function TokenHistory() {
  const { ticker } = useParams();
  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const { account } = useWalletManager();
  const firstAddress = account?.address;
  const {
    data: opList,
    setSize,
    isLoading,
  } = useOpListByAddressAndTicker(
    ticker && firstAddress ? { ticker, address: firstAddress } : undefined,
  );
  const { ref: trigger } = useIntersectionObserver({
    threshold: 0.5,
    onChange: async (isIntersecting) => {
      if (isIntersecting && !isLoading) {
        await setSize((prev) => prev + 1);
      }
    },
  });

  const tickerInfo = tokenInfoResponse?.result?.[0];
  const filteredOpList = opList?.flatMap(
    (page) => page.result?.filter((op) => op.opAccept === "1") ?? [],
  );
  const finished = opList && opList[opList.length - 1].next === undefined;

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      {filteredOpList?.map((op, index) => (
        <TokenHistoryItem key={index} tokenInfo={tickerInfo} op={op} />
      ))}
      {!finished && (
        <div
          className="inline-block size-6 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
          role="status"
          aria-label="loading"
        />
      )}
      <div ref={trigger}></div>
    </div>
  );
}
