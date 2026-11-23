import {
  EstimateGasExecutionError,
  ExecutionRevertedError,
  ContractFunctionRevertedError,
  InvalidInputRpcError,
  RpcRequestError,
} from "viem";
import { RpcErrorSchema, RPC_ERRORS } from "@/api/message";

const FUNDS_REASON = /insufficient funds|gas required exceeds allowance/i;

// The node's own sentence when it refused for lack of funds: estimateGas wraps
// it in EstimateGasExecutionError, sendRawTransaction throws it bare. viem keeps
// the RPC URL and request body in metaMessages, never in `details`.
export function nodeFundsReason(error: unknown): string | undefined {
  const rpc = error instanceof EstimateGasExecutionError ? error.cause : error;
  if (!(rpc instanceof InvalidInputRpcError)) return undefined;
  const reason = rpc.details?.split("\n")[0].trim().slice(0, 200);
  return reason && FUNDS_REASON.test(reason) ? reason : undefined;
}

export function handleViemError(error: unknown) {
  const fundsReason = nodeFundsReason(error);
  if (fundsReason) {
    return RpcErrorSchema.parse({ code: -32000, message: fundsReason });
  }

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
