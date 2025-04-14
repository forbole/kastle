import { useNavigate, useParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import { KNSTransferDetails } from "@/components/kns-transfer/KNSTransferDetails.tsx";
import React from "react";
import KNSTransferConfirm from "@/components/kns-transfer/KNSTransferConfirm.tsx";
import KNSTransferBroadcast from "@/components/kns-transfer/KNSTransferBroadcast.tsx";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface KNSTransferFormData {
  assetId: string;
  userInput: string | undefined;
  address: string | undefined;
  domain: string | undefined;
}

export default function KNSTransfer() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");

  const form = useForm<KNSTransferFormData>({
    defaultValues: { assetId },
    mode: "onChange",
  });
  const [outTxs, setOutTxs] = useState<string[]>();

  const onBack = () => {
    setStep((prevState) => {
      if (steps.indexOf(prevState) === 0) {
        navigate(`/kns/${assetId}`);
      }

      const stepIdx = steps.indexOf(prevState);
      return steps[stepIdx - 1];
    });
  };

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && (
          <KNSTransferDetails
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
        {step === "confirm" && (
          <KNSTransferConfirm
            onNext={() => setStep("broadcast")}
            onBack={onBack}
          />
        )}
        {step === "broadcast" && (
          <KNSTransferBroadcast
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
