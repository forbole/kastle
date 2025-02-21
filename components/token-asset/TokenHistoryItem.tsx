import kasIcon from "@/assets/images/kas-icon.svg";
import { formatUSD } from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTokenMetadata } from "@/hooks/useTokenMetadata.ts";
import { twMerge } from "tailwind-merge";
import { applyDecimal } from "@/lib/krc20.ts";
import { Op } from "@/hooks/useOpListByAddressAndTicker.ts";
import { explorerTxLinks } from "@/components/screens/Settings.tsx";

type TokenHistoryItemProps = { op: Op; tickerInfo?: TickerInfo | undefined };

export default function TokenHistoryItem({
  op,
  tickerInfo,
}: TokenHistoryItemProps) {
  useResetPreline();
  const { networkId } = useRpcClientStateful();
  const { ticker } = useParams();
  const { data: tokenMetadata, toPriceInUsd } = useTokenMetadata(ticker);
  const { account } = useWalletManager();
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { toFloat } = applyDecimal(tickerInfo?.dec);

  const firstAddress = account?.address;

  const explorerTxLink = explorerTxLinks[networkId ?? "mainnet"];

  let amount = 0;
  const operationName =
    op.op === "transfer"
      ? op.to === firstAddress
        ? "receive"
        : "send"
      : op.op;

  switch (op.op) {
    case "deploy":
      amount = toFloat(op.pre ? parseInt(op.pre, 10) : 0);
      break;
    default:
      amount = toFloat(op.amt ? parseInt(op.amt, 10) : 0);
      if (operationName === "send") {
        amount *= -1;
      }
  }

  const openTransaction = (transactionId: string) => {
    browser.tabs.create({
      url: `${explorerTxLink}${transactionId}`,
    });
  };

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
            <span className="capitalize">{operationName}</span>
            <span
              className={twMerge(
                amount < 0 ? "text-[#EF4444]" : "text-[#14B8A6]",
              )}
            >
              {amount >= 0 && "+"}
              {amount}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-daintree-400">
            <span className="flex items-center gap-2">
              TX Hash
              <div className="hs-tooltip inline-block [--placement:bottom] [--trigger:click]">
                <span className="hs-tooltip-toggle flex size-4 cursor-pointer items-center justify-center rounded-full bg-white/10 p-3 text-xs font-medium text-white">
                  2
                </span>
                <div
                  className="hs-tooltip-content invisible absolute z-10 flex flex-col gap-1.5 rounded-lg bg-daintree-700 px-4 py-3 text-sm text-white opacity-0 shadow-md transition-opacity hs-tooltip-shown:visible hs-tooltip-shown:opacity-100"
                  role="tooltip"
                >
                  <span>TX Hash</span>
                  <span className="text-xs font-semibold text-daintree-400">
                    {tickerInfo?.mtsAdd &&
                      new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(parseInt(op.mtsAdd, 10)))}
                  </span>
                  <div className="flex items-center gap-2">
                    <i className="hn hn-check-circle size-4 text-[#14B8A6]"></i>
                    <span>Commited</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openTransaction(op?.hashRev ?? "")}
                    className="flex items-center gap-2"
                  >
                    <i className="hn hn-check-circle size-4 text-[#14B8A6]"></i>
                    <span>Revealed</span>
                    <i className="hn hn-external-link text-daintree-400"></i>
                  </button>
                </div>
              </div>
            </span>
            <span>≈ {formatUSD(amount * toPriceInUsd())} USD</span>
          </div>
        </div>
      </div>
    </div>
  );
}
