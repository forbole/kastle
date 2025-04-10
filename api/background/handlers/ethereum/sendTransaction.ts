import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
  ethereumTransactionRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { isMatchCurrentAddress, isUserDeniedResponse } from "./utils";

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
  if (!params || params.length < 1) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

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

  ApiUtils.openPopup(tabId, url.toString());

  // Wait for the response from the popup
  const response = await ApiUtils.receiveExtensionMessage(message.id);
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
