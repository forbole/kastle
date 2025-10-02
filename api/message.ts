import { z } from "zod";

export enum Action {
  CONNECT,
  GET_ACCOUNT,
  SIGN_AND_BROADCAST_TX,
  SIGN_TX,
  GET_NETWORK,
  ETHEREUM_REQUEST,
  SIGN_MESSAGE,
  SWITCH_NETWORK,
  COMMIT_REVEAL,

  SEND_SOMPI,
}

// ================================================================================================

export const RpcRequestSchema = z.object({
  method: z.string(),
  params: z.array(z.unknown()).or(z.unknown()).optional(),
});

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

export type RpcError = z.infer<typeof RpcErrorSchema>;

export enum RpcErrorCode {
  USER_REJECTED_REQUEST = 4001,
  UNAUTHORIZED = 4100,
  METHOD_NOT_SUPPORTED = 4200,
  INTERNAL_ERROR = 5000,
  INVALID_PARAMS = -32602,
  TIMEOUT = -320603,
}

export const RPC_ERRORS = {
  USER_REJECTED_REQUEST: RpcErrorSchema.parse({
    code: RpcErrorCode.USER_REJECTED_REQUEST,
    message: "User rejected the request",
  }),

  UNAUTHORIZED: RpcErrorSchema.parse({
    code: RpcErrorCode.UNAUTHORIZED,
    message: "Unauthorized",
  }),
  UNSUPPORTED_CHAIN: RpcErrorSchema.parse({
    code: RpcErrorCode.UNAUTHORIZED,
    message: "Unsupported chain",
  }),
  METHOD_NOT_SUPPORTED: RpcErrorSchema.parse({
    code: RpcErrorCode.METHOD_NOT_SUPPORTED,
    message: "Method not supported",
  }),
  TIMEOUT: RpcErrorSchema.parse({
    code: RpcErrorCode.TIMEOUT,
    message: "Timeout",
  }),
  INTERNAL_ERROR: RpcErrorSchema.parse({
    code: RpcErrorCode.INTERNAL_ERROR,
    message: "Internal error",
  }),
  INVALID_PARAMS: RpcErrorSchema.parse({
    code: RpcErrorCode.INVALID_PARAMS,
    message: "Invalid params",
  }),
};

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
  error: z.union([z.string(), RpcErrorSchema]).optional(),
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
