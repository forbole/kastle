import { useFormContext } from "react-hook-form";
import React from "react";
import signImage from "@/assets/images/sign.png";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import { TokenOperationFormData } from "@/components/send/krc20-send/Krc20Transfer";
import { applyDecimal, computeOperationFees, Operation } from "@/lib/krc20.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { formatCurrency } from "@/lib/utils.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { Tooltip } from "react-tooltip";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenMetadata } from "@/hooks/kasplex/useTokenMetadata.ts";
import { textEllipsis } from "@/lib/utils.ts";
import HoverShowAllCopy from "@/components/HoverShowAllCopy.tsx";
import useWalletManager from "@/hooks/useWalletManager";

export const ConfirmTokenOperationStep = ({
  onNext,
  onBack,
}: {
  onNext?: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();
  const { watch } = useFormContext<TokenOperationFormData>();
  const kaspaPrice = useKaspaPrice();
  const { account } = useWalletManager();

  const { opData, domain } = watch();
  const { krc20Fee, kaspaFee, forboleFee, totalFees } = computeOperationFees(
    opData.op as Operation,
  );
  const { toPriceInUsd } = useTokenMetadata(
    opData.op === "mint" ? opData.tick : undefined,
  );
  const { data: tokenInfoResponse } = useTokenInfo(
    opData.op !== "deploy" ? opData.tick : undefined,
  );

  const tokenInfo = tokenInfoResponse?.result?.[0];

  const { toFloat: toFloatForExisting } = applyDecimal(tokenInfo?.dec);

  const tokenId = tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.ca;
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;

  const amount = toFloatForExisting(parseInt(opData.amt, 10));
  const fiatAmount = amount * toPriceInUsd();
  const fiatFees = totalFees * kaspaPrice.kaspaPrice;
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(fiatAmount);
  const { amount: feesCurrency, code: feesCurrencyCode } =
    useCurrencyValue(fiatFees);

  const onClose = () => {
    navigate("/dashboard");
  };

  return (
    <>
      <Header
        title="Confirm"
        onClose={onClose}
        onBack={onBack}
        showPrevious={!!onBack}
      />

      <div className="flex min-h-0 flex-col gap-2">
        <img
          alt="castle"
          className="h-[120px] w-[134px] self-center"
          src={signImage}
        />

        <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-scroll pr-1">
          {/* Sender */}
          {opData.op === "transfer" && (
            <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Send from</span>
                <span className="border-1 rounded-full border border-icy-blue-400 px-1 text-[0.625rem] font-medium text-icy-blue-400">
                  KRC20
                </span>
              </div>
              <span className="break-all text-xs text-daintree-400">
                {account?.address}
              </span>
            </div>
          )}

          {/* Recipient */}
          {opData.op === "transfer" && (
            <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Send to
                  <a className="text-icy-blue-400">
                    {!!domain && ` ${domain}`}
                  </a>
                </span>
                <span className="border-1 rounded-full border border-icy-blue-400 px-1 text-[0.625rem] font-medium text-icy-blue-400">
                  KRC20
                </span>
              </div>
              <span className="break-all text-xs text-daintree-400">
                {opData.to}
              </span>
            </div>
          )}

          <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Ticker</span>
                <div className="flex flex-col items-end">
                  <span className="font-medium">{tokenName}</span>
                  <HoverShowAllCopy text={tokenId ?? ""} tooltipWidth="22rem">
                    <span className="cursor-pointer text-xs text-daintree-400">
                      {textEllipsis(tokenId ?? "")}
                    </span>
                  </HoverShowAllCopy>
                </div>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Sending amount</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{amount}</span>
                  <span className="text-xs text-daintree-400">
                    {formatCurrency(amountCurrency, amountCurrencyCode)}
                  </span>
                </div>
              </div>
            </li>

            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Fee</span>
                  <i
                    className="hn hn-info-circle text-lg"
                    data-tooltip-id="info-tooltip"
                    data-tooltip-content={
                      forboleFee > 0
                        ? `${krc20Fee} KAS for KRC20 fees, ${kaspaFee} KAS for Kaspa network fees and ${forboleFee} KAS for Kastle fees.`
                        : `${krc20Fee} KAS for KRC20 fees and ${kaspaFee} KAS for Kaspa network fees.`
                    }
                  ></i>
                  <Tooltip
                    id="info-tooltip"
                    style={{
                      backgroundColor: "#374151",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "2px 8px",
                    }}
                  />
                </div>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{totalFees} KAS</span>
                  <span className="text-xs text-daintree-400">
                    {formatCurrency(feesCurrency, feesCurrencyCode)}
                  </span>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <button
        onClick={onNext}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
      >
        Confirm
      </button>
    </>
  );
};
