import { useNavigate } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import React from "react";
import { ConfirmTokenOperationStep } from "@/components/send/krc20-send/ConfirmTokenOperationStep";
import BroadcastTokenOperationStep from "@/components/send/krc20-send/BroadcastTokenOperationStep";
import { setPopupPath } from "@/lib/utils.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { applyDecimal } from "@/lib/krc20.ts";
import { useLocation } from "react-router";

const steps = ["confirm", "broadcast", "success", "fail"] as const;
type Step = (typeof steps)[number];

export interface TokenOperationFormData {
  opData: { op: string; tick: string; amt: string; to: string };
  domain: string;
}

export default function Krc20Transfer() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { ticker, amount, to, domain } = state as {
    ticker: string;
    amount: string;
    to: string;
    domain: string;
  };
  const [step, setStep] = useState<Step>("confirm");
  const form = useForm<TokenOperationFormData>({
    defaultValues: { opData: {}, domain },
  });
  const [outTxs, setOutTxs] = useState<string[]>();

  const { data: tokenInfoResponse, isLoading } = useTokenInfo(
    ticker ?? undefined,
  );

  useEffect(() => {
    setPopupPath();
    if (isLoading) {
      return;
    }

    if (!ticker || !amount || !to) {
      throw new Error("missing transfer parameters");
    }

    const { toInteger } = applyDecimal(tokenInfoResponse?.result?.[0].dec);

    form.setValue("opData", {
      op: "transfer",
      tick: ticker,
      amt: toInteger(parseFloat(amount)).toString(),
      to,
    });
  }, [isLoading]);

  const onBack = () =>
    navigate(
      { pathname: `/krc20/send/${ticker}` },
      {
        state: {
          form: {
            userInput: domain ?? to,
            amount,
            domain,
          },
        },
      },
    );

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "confirm" && (
          <ConfirmTokenOperationStep
            onNext={() => setStep("broadcast")}
            onBack={onBack}
          />
        )}
        {step === "broadcast" && (
          <BroadcastTokenOperationStep
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
