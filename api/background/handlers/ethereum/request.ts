import { Handler } from "@/api/background/utils";
import {
  ApiRequest,
  ApiResponse,
  RpcRequest,
  ETHEREUM_METHODS,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { requestAccountsHandler } from "./requestAccounts";
import { accountsHandler } from "./accounts";

/** ethereumRequestHandler to serve BrowserMessageType.ETHEREUM_REQUEST message */
export const ethereumRequestHandler: Handler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: any,
) => {
  if (!message.host) {
    sendResponse(new ApiResponse(message.id, null, "Host is required"));
    return;
  }

  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendResponse(
      new ApiResponse(message.id, null, "Extension is not initialized"),
    );
    return;
  }

  // TODO: Check if the network is evm compatible

  const { payload } = message;
  if (!RpcRequest.validate(payload)) {
    sendResponse(new ApiResponse(message.id, null, "Invalid payload"));
    return;
  }

  switch (payload.method) {
    case ETHEREUM_METHODS.REQUEST_ACCOUNTS:
      await requestAccountsHandler(tabId, message, sendResponse);
      break;
    case ETHEREUM_METHODS.ACCOUNTS:
      await accountsHandler(tabId, message, sendResponse);
      break;
    default:
      sendResponse(new ApiResponse(message.id, null, "Method not supported"));
      break;
  }
};
