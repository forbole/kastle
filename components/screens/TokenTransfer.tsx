import { useNavigate } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import React from "react";
import { ConfirmTokenOperationStep } from "@/components/token-operation/ConfirmTokenOperationStep.tsx";
import BroadcastTokenOperationStep from "@/components/token-operation/BroadcastTokenOperationStep.tsx";
import { setPopupPath } from "@/lib/utils.ts";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import { applyDecimal } from "@/lib/krc20.ts";
import { useLocation } from "react-router";

type Step = "confirm" | "broadcast" | "success" | "fail";

export interface TokenOperationFormData {
  opData: { op: string; tick: string; amt: string; to: string };
  domain: string;
}

export default function TokenTransfer() {
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

  const onBack = () => navigate({ pathname: "/send" }, { state });

  return (
    <div className="flex h-full flex-col gap-6 p-4 text-white">
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
