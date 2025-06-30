import { useNavigate } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { DetailsStep } from "@/components/send/kas-send/DetailsStep";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import { useLocation } from "react-router";
import { Broadcasting } from "@/components/send/Broadcasting.tsx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import HotWalletConfirm from "@/components/send/kas-send/HotWalletConfirm";
import LedgerConfirm from "@/components/send/kas-send/LedgerConfirm";
import z from "zod";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export const kasSendFormSchema = z.object({
  userInput: z.string().optional(),
  address: z.string().optional(),
  amount: z.string().optional(),
  amountFiat: z.string().optional(),
  domain: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  priorityFee: z.bigint().default(0n),
});

export type KasSendForm = z.infer<typeof kasSendFormSchema>;

export interface SendState {
  form?: KasSendForm;
  step?: Step;
}

export default function KasSend() {
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
  const { wallet } = useWalletManager();

  const form = useForm<KasSendForm>({
    defaultValues: {
      userInput: state?.form?.userInput ?? "",
      priorityFee: 0n,
      priority: "medium",
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
