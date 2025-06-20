import { FormProvider, useForm } from "react-hook-form";
import { DetailsStep } from "./DetailsStep";
import z from "zod";
import { useLocation } from "react-router";

export const krc20SendFormSchema = z.object({
  userInput: z.string().optional(),
  address: z.string().optional(),
  amount: z.string().optional(),
  amountFiat: z.string().optional(),
  domain: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  priorityFee: z.bigint().default(0n),
});

export type KRC20SendForm = z.infer<typeof krc20SendFormSchema>;

export interface SendState {
  form?: KRC20SendForm;
}

export function Krc20Send() {
  const { state } = useLocation() as {
    state?: {
      form: {
        userInput?: string;
        address?: string;
        amount?: string;
      };
    };
  };

  const form = useForm<KRC20SendForm>({
    defaultValues: {
      userInput: state?.form?.userInput ?? "",
      address: state?.form?.address,
      amount: state?.form?.amount ?? "",
      priority: "medium",
      priorityFee: 0n,
    },
    mode: "onChange",
  });

  console.log(state);

  return (
    <div className="relative flex h-screen flex-col p-4">
      <FormProvider {...form}>
        <DetailsStep />
      </FormProvider>
    </div>
  );
}
