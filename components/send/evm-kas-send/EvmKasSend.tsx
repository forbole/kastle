import { useNavigate, useLocation } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import EvmKasSendDetails from "./EvmKasSendDetails";

import z from "zod";

export const EvmKasSendFormSchema = z.object({
  userInput: z.string().optional(),
  address: z.string().optional(),
  amount: z.string().optional(),
  amountFiat: z.string().optional(),
});

export type EvmKasSendForm = z.infer<typeof EvmKasSendFormSchema>;

export interface SendState {
  form?: EvmKasSendForm;
  step?: Step;
}

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export default function EvmKasSend() {
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: SendState };
  const [step, setStep] = useState<Step>(state?.step ?? "details");

  const form = useForm<EvmKasSendForm>({
    defaultValues: {
      address: state?.form?.address,
      amount: state?.form?.amount ?? "",
    },
    mode: "onChange",
  });

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
          <EvmKasSendDetails
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
      </FormProvider>
    </div>
  );
}
