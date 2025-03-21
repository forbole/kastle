import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import React from "react";
import signImage from "@/assets/images/sign.png";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import useTransactionEstimate from "@/hooks/useTransactionEstimate";
import useWalletManager from "@/hooks/useWalletManager.ts";

export const ConfirmStep = ({
  onNext,
  onBack,
}: {
  onNext?: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();

  const { account } = useWalletManager();
  const { watch } = useFormContext<SendFormData>();
  const { address, amount, domain } = watch();
  const kapsaPrice = useKaspaPrice();
  const amountNumber = parseFloat(amount ?? "0");

  const transactionEstimate = useTransactionEstimate({
    account,
    outputs: address && amount ? [{ address, amount }] : [],
  });

  const transactionFee = transactionEstimate?.totalFees ?? "0";
  const transactionFeeNumber = parseFloat(transactionFee);

  const onClose = () => {
    navigate("/dashboard");
  };

  return (
    <>
      <Header title="Confirm" onClose={onClose} onBack={onBack} />

      <div className="flex h-full flex-col gap-2">
        <img
          alt="castle"
          className="h-[120px] w-[134px] self-center"
          src={signImage}
        />

        {/* Recipient */}
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">
            Recipient
            {!!domain && ` - ${domain}`}
          </span>
          <span className="break-all text-xs text-daintree-400">{address}</span>
        </div>

        <ul className="flex flex-col rounded-lg bg-daintree-800">
          <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
            <div className="flex w-full items-start justify-between">
              <span className="font-medium">Sending amount</span>
              <div className="flex flex-col text-right">
                <span className="font-medium">
                  {amountNumber.toFixed(3)} KAS
                </span>
                <span className="text-xs text-daintree-400">
                  {(amountNumber * kapsaPrice.kaspaPrice).toFixed(3)} USD
                </span>
              </div>
            </div>
          </li>
          <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
            <div className="flex w-full items-start justify-between">
              <span className="font-medium">Fee</span>
              <div className="flex flex-col text-right">
                <span className="font-medium">
                  {transactionFeeNumber != 0 && transactionFeeNumber < 0.001
                    ? "<0.001"
                    : transactionFeeNumber.toFixed(3)}{" "}
                  KAS
                </span>
                <span className="text-xs text-daintree-400">
                  {(transactionFeeNumber * kapsaPrice.kaspaPrice).toFixed(3)}{" "}
                  USD
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
