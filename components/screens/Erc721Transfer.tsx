import { useParams, useNavigate } from "react-router-dom";
import { Hex, Address } from "viem";
import { FormProvider, useForm } from "react-hook-form";
import Erc721TransferDetails from "@/components/send/evm/erc721-transfer/Erc721TransferDetails";
import Erc721TransferHotWalletConfirm from "@/components/send/evm/erc721-transfer/Erc721TransferHotWalletConfirm";
import { Broadcasting } from "../send/Broadcasting";
import useErc721Info from "@/hooks/evm/useErc721Info";
import FailStatus from "@/components/send/evm/FailStatus";
import SuccessStatus from "@/components/send/evm/SuccessStatus";
import { useState } from "react";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;
type Step = (typeof steps)[number];

export interface Erc721TransferFormData {
  userInput: string | undefined;
  address: Hex | undefined;
}

export default function Erc721Transfer() {
  const { chainId, contractAddress, tokenId } = useParams<{
    chainId: Hex;
    contractAddress: Address;
    tokenId: string;
  }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");
  const [outTxs, setOutTxs] = useState<string[]>();

  const { data } = useErc721Info(chainId, contractAddress, tokenId);

  const onBack = () => {
    setStep((prevState) => {
      if (steps.indexOf(prevState) === 0) {
        navigate("/");
      }

      const stepIdx = steps.indexOf(prevState);
      return steps[stepIdx - 1];
    });
  };

  const form = useForm<Erc721TransferFormData>({
    defaultValues: {},
    mode: "onChange",
  });

  const isValidParams = chainId && contractAddress && tokenId;

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {isValidParams && step === "details" && (
          <Erc721TransferDetails
            chainId={chainId}
            contractAddress={contractAddress}
            tokenId={tokenId}
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}

        {isValidParams && step === "confirm" && (
          <Erc721TransferHotWalletConfirm
            chainId={chainId}
            contractAddress={contractAddress}
            tokenId={tokenId}
            onNext={() => setStep("broadcast")}
            onBack={onBack}
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
          />
        )}
        {step === "broadcast" && (
          <Broadcasting onSuccess={() => setStep("success")} />
        )}
        {isValidParams && step === "success" && (
          <SuccessStatus
            chainId={chainId}
            transactionIds={outTxs}
            tokenName={data?.metadata?.name ?? "Empty Name"}
          />
        )}
        {isValidParams && step === "fail" && (
          <FailStatus
            chainId={chainId}
            transactionIds={outTxs}
            tokenName={data?.metadata?.name ?? "Empty Name"}
          />
        )}
      </FormProvider>
    </div>
  );
}
