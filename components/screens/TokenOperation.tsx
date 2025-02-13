import { useNavigate, useSearchParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import React from "react";
import { ConfirmTokenOperationStep } from "@/components/token-operation/ConfirmTokenOperationStep.tsx";
import BroadcastTokenOperationStep from "@/components/token-operation/BroadcastTokenOperationStep.tsx";
import { setPopupPath } from "@/lib/utils.ts";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import { applyDecimal } from "@/lib/krc20.ts";

const steps = ["confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface TokenOperationFormData {
  opData: Record<string, string>;
}

export default function TokenOperation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>("confirm");
  const form = useForm<TokenOperationFormData>({
    defaultValues: { opData: {} },
  });
  const [outTxs, setOutTxs] = useState<string[]>();

  const op = searchParams.get("op");
  const ticker = searchParams.get("ticker");
  const maxSupply = searchParams.get("maxSupply");
  const mintAmount = searchParams.get("mintAmount");
  const preAllocation = searchParams.get("preAllocation");
  const decimalPlaces = searchParams.get("decimalPlaces");
  const amount = searchParams.get("amount");
  const to = searchParams.get("to");

  const { data: tokenInfoResponse } = useTokenInfo(ticker ?? undefined);
  const { toInteger } = applyDecimal(tokenInfoResponse?.result?.[0].dec);

  useEffect(() => {
    setPopupPath();
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
      case "mint":
        if (!ticker) {
          throw new Error("missing mint parameters");
        }

        form.setValue("opData", {
          p: "krc-20",
          op: "mint",
          tick: ticker,
        });
        break;
      case "transfer":
        if (!ticker || !amount || !to) {
          throw new Error("missing transfer parameters");
        }

        form.setValue("opData", {
          p: "krc-20",
          op: "transfer",
          tick: ticker,
          amount: toInteger(parseFloat(amount)).toString(),
          to,
        });
        break;
    }
  }, []);

  const onBack = () => {
    if (op === "transfer") {
      navigate(-1);
    }

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
