import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { isMatchCurrentAddress, isUserDeniedResponse } from "./utils";
import { isAddress, isHex } from "viem";
import { z } from "zod";

export const ethereumTransactionRequestSchema = z.object({
  from: z.string().refine(isAddress, "Must be a valid Ethereum address"),
  to: z.string().refine(isAddress, "Must be a valid Ethereum address"),
  value: z.string().refine(isHex, "Value must be a hex string").optional(),
  data: z.string().refine(isHex, "Data must be a hex string").optional(),
  maxFeePerGas: z
    .string()
    .refine(isHex, "Max fee per gas must be a hex string")
    .optional(),
  maxPriorityFeePerGas: z
    .string()
    .refine(isHex, "Max priority fee must be a hex string")
    .optional(),
  chainId: z.string().refine(isHex, "Chain ID must be a hex string").optional(),
  gas: z.string().refine(isHex, "Gas must be a hex string").optional(),
});

// ================================================================================

export const sendTransactionHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: RpcError) {
    sendResponse(ApiUtils.createApiResponse(message.id, null, error));
  };

  const isConnected = await ApiUtils.isHostConnected(message.host);
  if (!isConnected) {
    sendError(RPC_ERRORS.UNAUTHORIZED);
    return;
  }

  const request = RpcRequestSchema.parse(message.payload);
  if (!Array.isArray(request.params) || request.params.length < 1) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const { params } = request;
  const payload = params[0];
  const result = ethereumTransactionRequestSchema.safeParse(payload);
  if (!result.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const transaction = result.data;
  const fromAddress = transaction.from;
  const isMatch = await isMatchCurrentAddress(fromAddress);
  if (!isMatch) {
    sendError(RPC_ERRORS.UNAUTHORIZED);
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/ethereum/send-transaction`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set(
    "payload",
    encodeURIComponent(JSON.stringify(transaction)),
  );

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  if (isUserDeniedResponse(response)) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        RPC_ERRORS.USER_REJECTED_REQUEST,
      ),
    );
    return;
  }

  sendResponse(response);
};
