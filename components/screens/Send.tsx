import { useNavigate, useSearchParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { DetailsStep } from "@/components/send/DetailsStep.tsx";
import { ConfirmStep } from "@/components/send/ConfirmStep.tsx";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import Sending from "@/components/send/Sending.tsx";
import React, { useRef } from "react";
import { useLocation } from "react-router";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface SendFormData {
  ticker: string;
  userInput: string | undefined;
  address: string | undefined;
  amount: string | undefined;
  amountUSD: string | undefined;
  domain: string | undefined;
}

export interface SendState {
  form?: SendFormData;
  step?: Step;
}

export default function Send() {
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: SendState };
  const [step, setStep] = useState<Step>(state?.step ?? "details");

  const form = useForm<SendFormData>({
    defaultValues: {
      ticker: state?.form?.ticker ?? "kas",
      address: state?.form?.address,
      amount: state?.form?.amount ?? "",
    },
    mode: "onChange",
  });
  const [outTxs, setOutTxs] = useState<string[]>();

  const onBack = () => {
    setStep((prevState) => {
      if (steps.indexOf(prevState) === 0) {
        navigate("/dashboard");
      }

      const stepIdx = steps.indexOf(prevState);
      return steps[stepIdx - 1];
    });
  };

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && (
          <DetailsStep onNext={() => setStep("confirm")} onBack={onBack} />
        )}
        {step === "confirm" && (
          <ConfirmStep onNext={() => setStep("broadcast")} onBack={onBack} />
        )}
        {step === "broadcast" && (
          <Sending
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
            onSuccess={() => setStep("success")}
          />
        )}
        {step === "success" && <SuccessStatus transactionIds={outTxs} />}
        {step === "fail" && <FailStatus transactionIds={outTxs} />}
      </FormProvider>
    </div>
  );
}
