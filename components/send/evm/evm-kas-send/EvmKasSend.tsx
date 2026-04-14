import { useNavigate, useLocation, useParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import DetailsStep from "./DetailsStep";
import HotWalletConfirm from "./HotWalletConfirm";
import { Broadcasting } from "../../Broadcasting";
import SuccessStatus from "../SuccessStatus";
import FailStatus from "../FailStatus";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useAnalytics from "@/hooks/useAnalytics";
import { hexToNumber } from "viem";

import z from "zod";

export const EvmKasSendFormSchema = z.object({
  userInput: z.string().optional(),
  address: z.string().optional(),
  amount: z.string().optional(),
  amountFiat: z.string().optional(),
});

export type EvmKasSendForm = z.infer<typeof EvmKasSendFormSchema>;

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export default function EvmKasSend() {
  const { wallet } = useWalletManager();
  const navigate = useNavigate();
  const { emitSendCompleted } = useAnalytics();
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
  const { chainId } = useParams<{ chainId: `0x${string}` }>();
  const [outTxs, setOutTxs] = useState<string[]>();

  const form = useForm<EvmKasSendForm>({
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
        {step === "details" && (
          <DetailsStep
            chainId={chainId!}
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
        {step === "confirm" && wallet?.type !== "ledger" && (
          <HotWalletConfirm
            chainId={chainId!}
            onNext={() => setStep("broadcast")}
            onBack={onBack}
            setOutTxs={setOutTxs}
            onFail={() => {
              emitSendCompleted({
                type: "EVM_KAS",
                id: chainId!,
                chainId: hexToNumber(chainId!),
                status: "failed",
              });
              setStep("fail");
            }}
          />
        )}
        {step == "broadcast" && (
          <Broadcasting
            onSuccess={() => {
              emitSendCompleted({
                type: "EVM_KAS",
                id: chainId!,
                chainId: hexToNumber(chainId!),
                status: "success",
              });
              setStep("success");
            }}
          />
        )}
        {step === "success" && (
          <SuccessStatus chainId={chainId!} transactionIds={outTxs} />
        )}
        {step === "fail" && (
          <FailStatus chainId={chainId!} transactionIds={outTxs} />
        )}
      </FormProvider>
    </div>
  );
}
