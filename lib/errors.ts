import {
  EstimateGasExecutionError,
  ExecutionRevertedError,
  ContractFunctionRevertedError,
  RpcRequestError,
} from "viem";
import { RpcErrorSchema, RPC_ERRORS } from "@/api/message";

export function handleViemError(error: unknown) {
  if (error instanceof EstimateGasExecutionError) {
    if (error.cause instanceof ExecutionRevertedError) {
      return RpcErrorSchema.parse({
        code: 3,
        message: `Reverted: ${error.cause.details || "Unknown reason"}`,
      });
    }
    return RpcErrorSchema.parse({
      code: 3,
      message: "Failed to estimate gas",
    });
  }

  if (error instanceof ContractFunctionRevertedError) {
    return RpcErrorSchema.parse({
      code: 3,
      message: `Reverted: ${error.reason || "Unknown reason"}`,
    });
  }

  if (error instanceof RpcRequestError) {
    return RpcErrorSchema.parse({
      code: error.code ?? -32000, // fallback to -32000 if no code
      message: error.shortMessage || error.message || "Unknown RPC error",
    });
  }

  return RPC_ERRORS.INTERNAL_ERROR;
}
