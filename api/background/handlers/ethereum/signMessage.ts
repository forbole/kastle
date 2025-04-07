import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";

export const signMessageHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: RpcError) {
    // NOTE: can not send undefined as response, so send null
    sendResponse(ApiUtils.createApiResponse(message.id, null, error));
  };

  const isConnected = await ApiUtils.isHostConnected(message.host);
  if (!isConnected) {
    sendError(RPC_ERRORS.UNAUTHORIZED);
    return;
  }

  const request = RpcRequestSchema.parse(message.payload);
  const { params } = request;
  if (params.length < 1) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const payload = params[0];
  const result = z.string().safeParse(payload);
  if (!result.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const parsedPayload = result.data;
  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/ethereum/sign-message`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("payload", encodeURIComponent(parsedPayload));

  ApiUtils.openPopup(tabId, url.toString());

  // Wait for the response from the popup
  const response = await ApiUtils.receiveExtensionMessage(message.id);

  sendResponse(response);
};
