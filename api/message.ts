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

export class RpcRequest {
  jsonrpc = "2.0";
  constructor(
    public readonly id: number,
    public readonly method: string,
    public readonly params: unknown[],
  ) {}

  static validate(data: unknown): data is RpcRequest {
    return (
      typeof data === "object" &&
      !!data &&
      "id" in data &&
      "method" in data &&
      "params" in data &&
      "jsonrpc" in data
    );
  }
}

// TODO: use viem RpcError types
export class RpcError {
  constructor(
    public readonly code: number,
    public readonly message: string,
  ) {}

  static validate(data: unknown): data is RpcError {
    return (
      typeof data === "object" && !!data && "code" in data && "message" in data
    );
  }
}

export enum RpcErrorCode {
  USER_REJECTED_REQUEST = 4001,
  UNAUTHORIZED = 4100,
  METHOD_NOT_SUPPORTED = 4200,
  INTERNAL_ERROR = 5000,
  TIMEOUT = -320603,
}

export const RPC_ERRORS = {
  USER_REJECTED_REQUEST: new RpcError(
    RpcErrorCode.USER_REJECTED_REQUEST,
    "User rejected the request",
  ),
  UNAUTHORIZED: new RpcError(RpcErrorCode.UNAUTHORIZED, "Unauthorized"),
  METHOD_NOT_SUPPORTED: new RpcError(
    RpcErrorCode.METHOD_NOT_SUPPORTED,
    "Method not supported",
  ),
  TIMEOUT: new RpcError(RpcErrorCode.TIMEOUT, "Request timeout"),
  INTERNAL_ERROR: new RpcError(RpcErrorCode.INTERNAL_ERROR, "Internal error"),
};

export enum ETHEREUM_METHODS {
  REQUEST_ACCOUNTS = "eth_requestAccounts",
  CHAIN_ID = "eth_chainId",
  ACCOUNTS = "eth_accounts",
  SIGN_TYPED_DATA_V4 = "eth_signTypedData_v4",
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
