import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { z } from "zod";

export enum Action {
  CONNECT,
  GET_ACCOUNT,
  SIGN_AND_BROADCAST_TX,
  SIGN_TX,
  GET_WALLET_ADDRESS,
  GET_PUBLIC_KEY,
  GET_NETWORK,
  SWITCH_NETWORK,
  SEND_KASPA,
  SIGN_MESSAGE,
  SIGN_PSKT,
  DO_COMMIT_REVEAL,
  DO_REVEAL_ONLY,
  COMPOUND_UTXO,
}

export const SignTxPayloadSchema = z.object({
  networkId: z.string(),
  txJson: z.string(),
  scripts: z.array(z.custom<ScriptOption>()).optional(),
});

export type SignTxPayload = z.infer<typeof SignTxPayloadSchema>;

// ================================================================================================

export const ConnectPayloadSchema = z.object({
  networkId: z.string(),
  name: z.string(),
  icon: z.string().optional(),
});

export type ConnectPayload = z.infer<typeof ConnectPayloadSchema>;

// ================================================================================================

export const ApiRequestSchema = z.object({
  action: z.nativeEnum(Action),
  id: z.string(),
  source: z.literal("browser"),
  target: z.literal("background"),
  payload: z.unknown().optional(),
});

export type ApiRequest = z.infer<typeof ApiRequestSchema>;

export const ApiRequestWithHostSchema = ApiRequestSchema.extend({
  host: z.string(),
});

export type ApiRequestWithHost = z.infer<typeof ApiRequestWithHostSchema>;

export const ApiResponseSchema = z.object({
  id: z.string(),
  response: z.unknown(),
  error: z.string().optional(),
  source: z.literal("background"),
  target: z.literal("browser"),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;

export const ApiExtensionResponseSchema = z.object({
  id: z.string(),
  response: z.unknown().optional(),
  error: z.string().optional(),
  source: z.literal("extension"),
  target: z.literal("background"),
});

export type ApiExtensionResponse = z.infer<typeof ApiExtensionResponseSchema>;
