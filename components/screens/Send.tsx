import { useNavigate } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { DetailsStep } from "@/components/send/DetailsStep.tsx";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import { useLocation } from "react-router";
import { Broadcasting } from "@/components/send/Broadcasting.tsx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import HotWalletConfirm from "@/components/send/HotWalletConfirm";
import LedgerConfirm from "@/components/send/LedgerConfirm";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface SendFormData {
  ticker: string;
  userInput: string | undefined;
  address: string | undefined;
  amount: string | undefined;
  amountFiat: string | undefined;
  domain: string | undefined;
  priority: "low" | "medium" | "high";
  priorityFee: bigint;
}

export interface SendState {
  form?: SendFormData;
  step?: Step;
}

export default function Send() {
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: SendState };
  const [step, setStep] = useState<Step>(state?.step ?? "details");
  const { wallet } = useWalletManager();

  const form = useForm<SendFormData>({
    defaultValues: {
      priorityFee: 0n,
      priority: "medium",
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
    <div className="relative flex h-full flex-col p-4 text-white">
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
