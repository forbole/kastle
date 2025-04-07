import { TransactionRequest } from "viem";
import { z } from "zod";
import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { isMatchCurrentAddress } from "./utils";

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
  const { params } = request;
  if (!params || params.length < 2) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }
  const payload = params[0];
  const schema = z.object({}).passthrough() as z.ZodType<TransactionRequest>;

  const result = schema.safeParse(payload);
  if (!result.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const transaction = result.data;
  const fromAddress = transaction.from;
  if (!fromAddress) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

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

  ApiUtils.openPopup(tabId, url.toString());

  // Wait for the response from the popup
  const ApiExtensionResponse = await ApiUtils.receiveExtensionMessage(
    message.id,
  );
  sendResponse(ApiExtensionResponse);
};
