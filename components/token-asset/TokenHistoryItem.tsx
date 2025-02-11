import kasIcon from "@/assets/images/kas-icon.svg";
import { formatUSD } from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTokenMetadata } from "@/hooks/useTokenMetadata.ts";
import { twMerge } from "tailwind-merge";
import { applyDecimal } from "@/lib/krc20.ts";
import { Op } from "@/hooks/useOpListByAddressAndTicker.ts";

type TokenHistoryItemProps = { op: Op; tickerInfo?: TickerInfo | undefined };

export default function TokenHistoryItem({
  op,
  tickerInfo,
}: TokenHistoryItemProps) {
  const { ticker } = useParams();
  const { data: tokenMetadata } = useTokenMetadata(ticker);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const decimal = applyDecimal(tickerInfo?.dec);

  let amount = 0;
  switch (op.op) {
    case "deploy":
      amount = decimal(op.pre ? parseInt(op.pre, 10) : 0);
      break;
    default:
      amount = decimal(op.amt ? parseInt(op.amt, 10) : 0);
  }

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
        <img
          alt="castle"
          className="h-[40px] w-[40px]"
          src={imageUrl}
          onError={onImageError}
        />
        <div className="flex flex-grow flex-col gap-1">
          <div className="flex items-center justify-between text-base text-white">
            <span className="capitalize">{op.op}</span>
            <span
              className={twMerge(
                amount < 0 ? "text-[#EF4444]" : "text-[#14B8A6]",
              )}
            >
              {amount}
            </span>
          </div>
          <div className="flex items-center justify-end text-sm text-daintree-400">
            <span>
              ≈ {formatUSD(amount * (tokenMetadata?.price?.priceInUsd ?? 0))}{" "}
              USD
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
