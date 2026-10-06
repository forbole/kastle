import { z } from "zod";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";

export const SignTxPayloadSchema = z.object({
  networkId: z.string().optional(),
  txJson: z.string(),
  scripts: z.array(z.custom<ScriptOption>()).default([]),
});

export type SignTxPayload = z.infer<typeof SignTxPayloadSchema>;

/**
 * M2: a covenant (version >= 1) tx can spend the user's KCC-20 pieces — the
 * covenant only checks that a co-present input is the owner's P2PK — and the
 * dApp confirm screen shows raw JSON, so dApp sign requests refuse them until
 * a KCC-20-aware decoder exists. The wallet's own KCC-20 send/swap signs via
 * wallet.signTx directly and never passes through here.
 * Fail closed: anything that isn't a parseable version-0 tx counts as covenant.
 */
export function isCovenantTxJson(txJson: string): boolean {
  try {
    return JSON.parse(txJson).version !== 0;
  } catch {
    return true;
  }
}
