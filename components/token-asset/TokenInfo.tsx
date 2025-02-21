import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import { useTokenMetadata } from "@/hooks/useTokenMetadata.ts";
import { formatUSD } from "@/lib/utils.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import { twMerge } from "tailwind-merge";
import LabelLoading from "@/components/LabelLoading.tsx";
import { applyDecimal } from "@/lib/krc20.ts";

export default function TokenInfo() {
  const { ticker } = useParams();
  const { data: tokenInfoResponse, isLoading: isTokenInfoLoading } =
    useTokenInfo(ticker);
  const {
    data: tokenMetadata,
    isLoading: isMetadataLoading,
    toPriceInUsd,
  } = useTokenMetadata(ticker);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const isLoading = isTokenInfoLoading || isMetadataLoading;
  const tokenInfo = tokenInfoResponse?.result?.[0];

  const { toFloat } = applyDecimal(tokenInfo?.dec);
  const max = tokenInfo ? parseInt(tokenInfo.max, 10) : 0;
  const minted = tokenInfo ? parseInt(tokenInfo.minted, 10) : 0;
  const totalMinted = `${((minted / max) * 100).toFixed(0)}% (${toFloat(minted).toLocaleString()}/${toFloat(max).toLocaleString()})`;

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      {/* Header card */}
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
              <span className="capitalize">{ticker}</span>
            </div>
            <div className="flex items-center justify-start text-sm text-daintree-400">
              <span>≈ {formatUSD(toPriceInUsd())} USD</span>
            </div>
          </div>
        </div>
      </div>

      {/*Details*/}
      <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Max supply</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {toFloat(max).toLocaleString()}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Total minted</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span
                className={twMerge(
                  "font-medium",
                  minted >= max ? "text-[#EF4444]" : "text-[#14B8A6]",
                )}
              >
                {totalMinted}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Holder Count</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {(tokenInfo?.holderTotal
                  ? parseInt(tokenInfo.holderTotal, 10)
                  : 0
                ).toLocaleString()}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Mint Count</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {(tokenInfo?.mintTotal
                  ? parseInt(tokenInfo.mintTotal, 10)
                  : 0
                ).toLocaleString()}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Transfer Count</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {(tokenInfo?.transferTotal
                  ? parseInt(tokenInfo.transferTotal, 10)
                  : 0
                ).toLocaleString()}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Preallocation Amount</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {(tokenInfo?.pre
                  ? toFloat(parseInt(tokenInfo.pre, 10))
                  : 0
                ).toLocaleString()}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Default Mint Amount</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {(tokenInfo?.lim
                  ? toFloat(parseInt(tokenInfo.lim, 10))
                  : 0
                ).toLocaleString()}
              </span>
            )}
          </div>
        </li>
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Decimal</span>
            {isLoading ? (
              <LabelLoading />
            ) : (
              <span className="font-medium">
                {(tokenInfo?.dec
                  ? parseInt(tokenInfo.dec, 10)
                  : 0
                ).toLocaleString()}
              </span>
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}
