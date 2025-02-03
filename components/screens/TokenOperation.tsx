import { useNavigate, useSearchParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { ConfirmStep } from "@/components/send/ConfirmStep.tsx";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import Sending from "@/components/send/Sending.tsx";
import React from "react";

const steps = ["confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface SendFormData {
  opData: Record<string, string>;
}

export default function TokenOperation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>("confirm");
  const form = useForm<SendFormData>({});
  const [outTxs, setOutTxs] = useState<string[]>();

  const op = searchParams.get("op");
  const ticker = searchParams.get("ticker");
  const maxSupply = searchParams.get("maxSupply");
  const mintAmount = searchParams.get("mintAmount");
  const preAllocation = searchParams.get("preAllocation");
  const decimalPlaces = searchParams.get("decimalPlaces");

  switch (op) {
    case "deploy":
      if (!ticker || !maxSupply || !mintAmount) {
        throw new Error("missing deploy parameters");
      }

      const opData: Record<string, string> = {
        p: "krc-20",
        op: "deploy",
        tick: ticker,
        max: maxSupply,
        lim: mintAmount,
      };

      if (decimalPlaces) {
        opData.dec = decimalPlaces;
      }
      if (preAllocation) {
        opData.pre = preAllocation;
      }

      form.setValue("opData", opData);
      break;
  }

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
