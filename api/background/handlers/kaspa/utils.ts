import { z } from "zod";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";

export const SignTxPayloadSchema = z.object({
  networkId: z.string(),
  txJson: z.string(),
  scripts: z.array(z.custom<ScriptOption>()).default([]),
});

export type SignTxPayload = z.infer<typeof SignTxPayloadSchema>;
