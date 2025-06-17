import { FormProvider, useForm } from "react-hook-form";
import { Krc20SendDetails } from "./Krc20SendDetails";
import z from "zod";

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

export function Krc20Send() {
  const form = useForm<KRC20SendForm>({});
  return (
    <FormProvider {...form}>
      <Krc20SendDetails />
    </FormProvider>
  );
}
