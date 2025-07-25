import { useNavigate, useLocation, useParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import DetailsStep from "./DetailsStep";
import HotWalletConfirm from "./HotWalletConfirm";
import { Broadcasting } from "../../Broadcasting";
import SuccessStatus from "../SuccessStatus";
import FailStatus from "../FailStatus";
import z from "zod";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export const Erc20SendFormSchema = z.object({
  userInput: z.string().optional(),
  address: z.string().optional(),
  amount: z.string().optional(),
  amountFiat: z.string().optional(),
});

export type Erc20SendForm = z.infer<typeof Erc20SendFormSchema>;

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export default function Erc20Send() {
  const { wallet } = useWalletManager();
  const navigate = useNavigate();
  const { state } = useLocation() as {
    state?: {
      step: Step;
      form: {
        userInput?: string;
        amount?: string;
      };
    };
  };
  const [step, setStep] = useState<Step>(state?.step ?? "details");
  const { chainId, tokenId } = useParams<{
    chainId: `0x${string}`;
    tokenId: `0x${string}`;
  }>();
  const [outTxs, setOutTxs] = useState<string[]>();

  const { assets } = useErc20Assets();
  const asset = assets.find(
    (asset) => asset.address === tokenId && asset.chainId === chainId,
  );

  const form = useForm<Erc20SendForm>({
    defaultValues: {
      userInput: state?.form?.userInput ?? "",
      amount: state?.form?.amount ?? "",
    },
    mode: "onChange",
  });

  const onBack = () => {
    setStep((prevState) => {
      if (steps.indexOf(prevState) === 0) {
        navigate(-1);
      }

      const stepIdx = steps.indexOf(prevState);
      return steps[stepIdx - 1];
    });
  };

  return (
    <div className="relative flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && asset && (
          <DetailsStep
            asset={asset}
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
        {step === "confirm" && asset && wallet?.type !== "ledger" && (
          <HotWalletConfirm
            asset={asset}
            onNext={() => setStep("broadcast")}
            onBack={onBack}
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
          />
        )}
        {step == "broadcast" && (
          <Broadcasting onSuccess={() => setStep("success")} />
        )}
        {step === "success" && asset && (
          <SuccessStatus
            chainId={asset.chainId}
            transactionIds={outTxs}
            tokenName={asset.symbol}
          />
        )}
        {step === "fail" && asset && (
          <FailStatus
            chainId={asset.chainId}
            transactionIds={outTxs}
            tokenName={asset.symbol}
          />
        )}
      </FormProvider>
    </div>
  );
}
