import kasIcon from "@/assets/images/kas-icon.svg";
import { formatUSD } from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Op, TickerInfo } from "@/hooks/useKasplex.ts";
import { TokenMetadata } from "@/hooks/useKasFyi.ts";

type TokenHistoryItemProps = { op: Op; tickerInfo?: TickerInfo | undefined };

export default function TokenHistoryItem({
  op,
  tickerInfo,
}: TokenHistoryItemProps) {
  const { ticker } = useParams();
  const { fetchTokenMetadataByTicker } = useKasFyi();
  const [tokenMetadata, setTokenMetadata] = useState<TokenMetadata>();
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const decimalPlaces = tickerInfo?.dec ? parseInt(tickerInfo.dec, 10) : 8;
  const decimalCoefficient = Math.pow(10, decimalPlaces);
  let amount = 0;
  switch (op.op) {
    case "deploy":
      amount = (op.pre ? parseInt(op.pre, 10) : 0) / decimalCoefficient;
      break;
    default:
      amount = (op.amt ? parseInt(op.amt, 10) : 0) / decimalCoefficient;
  }

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    const fetchTokenMetadata = async () => {
      if (!ticker) {
        return;
      }

      const tokenMetadata = await fetchTokenMetadataByTicker(ticker);
      setTokenMetadata(tokenMetadata);
    };

    fetchTokenMetadata();
  }, []);

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  return (
    <div className="flex cursor-pointer flex-col items-stretch gap-2">
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
            <span>{amount}</span>
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
