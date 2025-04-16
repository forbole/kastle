import { useNavigate, useParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { KRC721TransferDetails } from "@/components/krc-721-transfer/KRC721TransferDetails.tsx";
import React from "react";
import KRC721TransferConfirm from "@/components/krc-721-transfer/KRC721TransferConfirm.tsx";
import KRC721TransferBroadcast from "@/components/krc-721-transfer/KRC721TransferBroadcast.tsx";
import KRC721TransferSuccess from "@/components/krc-721-transfer/KRC721TransferSuccess.tsx";
import KRC721TransferFailure from "@/components/krc-721-transfer/KRC721TransferFailure.tsx";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface KRC721TransferFormData {
  tick: string;
  tokenId: string;
  userInput: string | undefined;
  address: string | undefined;
  domain: string | undefined;
}

export default function KRC721Transfer() {
  const { tick, tokenId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");

  const form = useForm<KRC721TransferFormData>({
    defaultValues: { tick, tokenId },
    mode: "onChange",
  });
  const [outTxs, setOutTxs] = useState<string[]>();

  const onBack = () => {
    setStep((prevState) => {
      if (steps.indexOf(prevState) === 0) {
        navigate(`/krc-721/${tick}/${tokenId}`);
      }

      const stepIdx = steps.indexOf(prevState);
      return steps[stepIdx - 1];
    });
  };

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && (
          <KRC721TransferDetails
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
        {step === "confirm" && (
          <KRC721TransferConfirm
            onNext={() => setStep("broadcast")}
            onBack={onBack}
          />
        )}
        {step === "broadcast" && (
          <KRC721TransferBroadcast
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
            onSuccess={() => setStep("success")}
          />
        )}
        {step === "success" && (
          <KRC721TransferSuccess transactionIds={outTxs} />
        )}
        {step === "fail" && <KRC721TransferFailure transactionIds={outTxs} />}
      </FormProvider>
    </div>
  );
}
