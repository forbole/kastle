import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { z } from "zod";

export enum Action {
  CONNECT,
  GET_ACCOUNT,
  SIGN_AND_BROADCAST_TX,
  SIGN_TX,
  ETHEREUM_REQUEST,
}

export const SignTxPayloadSchema = z.object({
  networkId: z.string(),
  txJson: z.string(),
  scripts: z.array(z.custom<ScriptOption>()).optional(),
});

export type SignTxPayload = z.infer<typeof SignTxPayloadSchema>;

// ================================================================================================

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  method: z.string(),
  params: z.array(z.unknown()),
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

export enum ETHEREUM_METHODS {
  REQUEST_ACCOUNTS = "eth_requestAccounts",
  CHAIN_ID = "eth_chainId",
  ACCOUNTS = "eth_accounts",
  SIGN_TYPED_DATA_V4 = "eth_signTypedData_v4",
  SIGN_TRANSACTION = "eth_signTransaction",
  SEND_TRANSACTION = "eth_sendTransaction",
  SIGN_MESSAGE = "personal_sign",
  WALLET_SWITCH_ETHEREUM_NETWORK = "wallet_switchEthereumChain",
}

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
