import { useFormContext } from "react-hook-form";
import React, { useEffect, useState } from "react";
import signImage from "@/assets/images/sign.png";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import { TokenOperationFormData } from "@/components/screens/TokenOperation.tsx";
import { Fee } from "@/lib/krc20.ts";

export const ConfirmTokenOperationStep = ({
  onNext,
  onBack,
}: {
  onNext?: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();
  const { fetchTokenInfo } = useKasplex();
  const { watch } = useFormContext<TokenOperationFormData>();
  const [mintAmount, setMintAmount] = useState<string>();
  const opData = watch("opData");
  const decimalCoefficient = Math.pow(
    10,
    opData.dec ? parseInt(opData.dec, 10) : 8,
  );
  const kapsaPrice = useKaspaPrice();

  const onClose = () => {
    navigate("/dashboard");
  };

  useEffect(() => {
    if (opData.op === "mint") {
      fetchTokenInfo(opData.tick).then((tokenInfo) => {
        const tokenDetails = tokenInfo?.result?.[0];
        if (!tokenDetails) {
          return;
        }

        setMintAmount(
          (
            parseInt(tokenDetails.lim, 10) / decimalCoefficient
          ).toLocaleString(),
        );
      });
    }
  }, []);

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
                    {parseInt(opData.max, 10) / decimalCoefficient}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Default Mint Amount</span>
                  <span className="font-medium">
                    {parseInt(opData.lim, 10) / decimalCoefficient}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Preallocation</span>
                  <span className="font-medium">
                    {parseInt(opData.pre, 10) / decimalCoefficient}
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
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-zinc-700 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
};
