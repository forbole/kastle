import { useNavigate } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { AddressStep } from "@/components/send/AddressStep.tsx";
import { AmountStep } from "@/components/send/AmountStep.tsx";
import { ConfirmStep } from "@/components/send/ConfirmStep.tsx";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import Sending from "@/components/send/Sending.tsx";
import React from "react";

const steps = [
  "address",
  "amount",
  "confirm",
  "broadcast",
  "success",
  "fail",
] as const;

type Step = (typeof steps)[number];

export interface SendFormData {
  address: string | undefined;
  amount: string | undefined;
  amountUSD: string | undefined;
}

export default function Send() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("address");
  const form = useForm<SendFormData>({
    defaultValues: {
      address: undefined,
      amount: "",
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
    <div className="flex h-full flex-col gap-6 p-4 text-white">
      <FormProvider {...form}>
        {step === "address" && (
          <AddressStep onNext={() => setStep("amount")} onBack={onBack} />
        )}
        {step === "amount" && (
          <AmountStep onNext={() => setStep("confirm")} onBack={onBack} />
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
