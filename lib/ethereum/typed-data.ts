import type { SignTypedDataParameters } from "viem";
import { z } from "zod";

const typedDataObjectSchema = z
  .object({
    types: z.record(z.string(), z.array(z.unknown())),
    primaryType: z.string().min(1),
    domain: z.record(z.string(), z.unknown()).optional(),
    message: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/**
 * EIP-712 payload as sent by a dApp: either the JSON string MetaMask expects
 * or an already-parsed object. Always yields a canonical object.
 */
export const signTypedDataSchema = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .transform((value, ctx) => {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Typed data is not valid JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(typedDataObjectSchema)
  .transform((value) => value as unknown as SignTypedDataParameters);
