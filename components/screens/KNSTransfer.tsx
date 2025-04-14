import { useNavigate, useParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import { Broadcasting } from "@/components/send/Broadcasting.tsx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import HotWalletConfirm from "@/components/send/HotWalletConfirm";
import LedgerConfirm from "@/components/send/LedgerConfirm";
import { DetailsStep } from "@/components/kns-transfer/DetailsStep.tsx";

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
  const { wallet } = useWalletManager();

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
          <DetailsStep onNext={() => setStep("confirm")} onBack={onBack} />
        )}
        {step === "confirm" && wallet?.type !== "ledger" && (
          <HotWalletConfirm
            onNext={() => setStep("broadcast")}
            onBack={onBack}
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
          />
        )}
        {step === "confirm" && wallet?.type === "ledger" && (
          <LedgerConfirm
            onNext={() => setStep("broadcast")}
            onBack={onBack}
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
          />
        )}
        {step === "broadcast" && (
          <Broadcasting onSuccess={() => setStep("success")} />
        )}
        {step === "success" && <SuccessStatus transactionIds={outTxs} />}
        {step === "fail" && <FailStatus transactionIds={outTxs} />}
      </FormProvider>
    </div>
  );
}
