import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { formatCurrency } from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { applyDecimal } from "@/lib/krc20.ts";
import { Op } from "@/hooks/useOpListByAddressAndTicker.ts";
import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { TokenInfo } from "@/hooks/kasplex/useKasplex";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useResetPreline from "@/hooks/useResetPreline.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import { useKrc20Prices } from "@/hooks/kasplex/useKrc20Prices";

type TokenHistoryItemProps = { op: Op; tokenInfo?: TokenInfo | undefined };

export default function TokenHistoryItem({
  op,
  tokenInfo,
}: TokenHistoryItemProps) {
  useResetPreline();
  const { networkId } = useRpcClientStateful();
  const { ticker } = useParams();
  const { logo } = useKrc20Logo(ticker);
  const { account } = useWalletManager();
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { toFloat } = applyDecimal(tokenInfo?.dec);
  const { price } = useKrc20Prices(ticker);

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

  const fiatAmount = amount * (price ?? 0);
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(fiatAmount);

  const openTransaction = (transactionId: string) => {
    browser.tabs.create({
      url: `${explorerTxLink}${transactionId}`,
    });
  };

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (logo) {
      setImageUrl(logo);
    }
  }, [logo]);

  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
        <img
          alt="castle"
          className="h-[40px] w-[40px] rounded-full"
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
          <div className="hs-tooltip hs-tooltip-toggle flex items-center justify-between text-sm text-daintree-400 [--placement:bottom] [--trigger:hover]">
            <div
              className="hs-tooltip-content invisible absolute z-10 flex flex-col gap-1.5 rounded-lg bg-daintree-700 px-4 py-3 text-sm text-white opacity-0 shadow-md transition-opacity after:absolute after:-top-6 after:left-0 after:h-8 after:w-14 hs-tooltip-shown:visible hs-tooltip-shown:opacity-100"
              role="tooltip"
            >
              <span>TX Hash</span>
              <span className="text-xs font-semibold text-daintree-400">
                {tokenInfo?.mtsAdd &&
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
            <span className="flex items-center gap-2">
              TX Hash
              <span className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-white/10 p-3 text-xs font-medium text-white">
                2
              </span>
            </span>
            <span>≈ {formatCurrency(amountCurrency, amountCurrencyCode)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
