import { useFormContext } from "react-hook-form";
import React from "react";
import signImage from "@/assets/images/sign.png";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import { TokenOperationFormData } from "@/components/screens/TokenOperation.tsx";
import { applyDecimal, Fee } from "@/lib/krc20.ts";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";

export const ConfirmTokenOperationStep = ({
  onNext,
  onBack,
}: {
  onNext?: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();
  const { watch } = useFormContext<TokenOperationFormData>();
  const opData = watch("opData");
  const decimal = applyDecimal(opData.dec);
  const kapsaPrice = useKaspaPrice();
  const { data: tokenInfoResponse } = useTokenInfo(
    opData.op === "mint" ? opData.tick : undefined,
  );
  const limParam = tokenInfoResponse?.result?.[0]?.lim;
  const mintAmount = limParam
    ? decimal(parseInt(limParam, 10)).toLocaleString()
    : undefined;

  const onClose = () => {
    navigate("/dashboard");
  };

  return (
    <>
      <Header title="Confirm" onClose={onClose} onBack={onBack} />

      <div className="flex h-full flex-col gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[134px] self-center"
          src={signImage}
        />

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
                    {decimal(parseInt(opData.max, 10))}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Default Mint Amount</span>
                  <span className="font-medium">
                    {decimal(parseInt(opData.lim, 10))}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Preallocation</span>
                  <span className="font-medium">
                    {decimal(parseInt(opData.pre, 10))}
                  </span>
                </div>
              </li>
            </>
          )}
          {opData.op === "mint" && (
            <>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Mint amount</span>
                  <span className="font-medium">{mintAmount}</span>
                </div>
              </li>
            </>
          )}

          <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
            <div className="flex w-full items-start justify-between">
              <span className="font-medium">Fee</span>
              <div className="flex flex-col text-right">
                <span className="font-medium">{Fee.Deploy + Fee.Base} KAS</span>
                <span className="text-xs text-daintree-400">
                  {(Fee.Deploy + Fee.Base) * kapsaPrice.kaspaPrice} USD
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
