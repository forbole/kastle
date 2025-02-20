import { useFormContext } from "react-hook-form";
import React from "react";
import signImage from "@/assets/images/sign.png";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import { TokenOperationFormData } from "@/components/screens/TokenOperation.tsx";
import { applyDecimal, computeOperationFees, Operation } from "@/lib/krc20.ts";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import { formatUSD } from "@/lib/utils.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { Tooltip } from "react-tooltip";

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

  const opData = watch("opData");
  const { krc20Fee, kaspaFee, forboleFee, totalFees } = computeOperationFees(
    opData.op as Operation,
  );
  const { toFloat } = applyDecimal(opData.dec);
  const { toPriceInUsd } = useTokenMetadata(
    opData.op === "mint" ? opData.tick : undefined,
  );
  const { data: tokenInfoResponse } = useTokenInfo(
    opData.op !== "deploy" ? opData.tick : undefined,
  );
  const limParam = tokenInfoResponse?.result?.[0]?.lim;
  const mintAmount = limParam
    ? toFloat(parseInt(limParam, 10)).toLocaleString()
    : undefined;
  const { toFloat: toFloatForExisting } = applyDecimal(
    tokenInfoResponse?.result?.[0]?.dec,
  );
  const amount = toFloatForExisting(parseInt(opData.amt, 10));

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

      <div className="flex h-full flex-col gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[134px] self-center"
          src={signImage}
        />

        {/* Recipient */}
        {opData.op === "transfer" && (
          <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
            <span className="text-base font-medium">Recipient</span>
            <span className="break-all text-xs text-daintree-400">
              {opData.to}
            </span>
          </div>
        )}

        <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
          <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
            <div className="flex w-full items-start justify-between">
              <span className="font-medium">Ticker</span>
              <span className="font-medium">{opData.tick}</span>
            </div>
          </li>
          {opData.op === "deploy" && (
            <>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Maximum Supply</span>
                  <span className="font-medium">
                    {toFloat(parseInt(opData.max, 10))}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Default Mint Amount</span>
                  <span className="font-medium">
                    {toFloat(parseInt(opData.lim, 10))}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Preallocation</span>
                  <span className="font-medium">
                    {toFloat(parseInt(opData.pre, 10))}
                  </span>
                </div>
              </li>
            </>
          )}
          {opData.op === "mint" && (
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Mint amount</span>
                <span className="font-medium">{mintAmount}</span>
              </div>
            </li>
          )}
          {opData.op === "transfer" && (
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Sending amount</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{amount}</span>
                  <span className="text-xs text-daintree-400">
                    {formatUSD(amount * toPriceInUsd())} USD
                  </span>
                </div>
              </div>
            </li>
          )}

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
                  {formatUSD(totalFees * kaspaPrice.kaspaPrice)} USD
                </span>
              </div>
            </div>
          </li>
        </ul>

        <div className="mt-auto">
          <button
            onClick={onNext}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
};
