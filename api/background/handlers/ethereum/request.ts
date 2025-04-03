import { Handler } from "@/api/background/utils";
import {
  RpcRequestSchema,
  ETHEREUM_METHODS,
  RPC_ERRORS,
  ApiRequestWithHost,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { requestAccountsHandler } from "./requestAccounts";
import { accountsHandler } from "./accounts";
import { chainIdHandler } from "./chainId";

/** ethereumRequestHandler to serve BrowserMessageType.ETHEREUM_REQUEST message */
export const ethereumRequestHandler: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        "Extension is not initialized",
      ),
    );
    return;
  }

  // TODO: Check if the network is evm compatible

  const { payload } = message;
  const result = RpcRequestSchema.safeParse(payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid payload"),
    );
    return;
  }

  const parsedPayload = result.data;
  try {
    switch (parsedPayload.method) {
      case ETHEREUM_METHODS.REQUEST_ACCOUNTS:
        await requestAccountsHandler(tabId, message, sendResponse);
        break;
      case ETHEREUM_METHODS.ACCOUNTS:
        await accountsHandler(tabId, message, sendResponse);
        break;
      case ETHEREUM_METHODS.CHAIN_ID:
        await chainIdHandler(tabId, message, sendResponse);
        break;
      default:
        sendResponse(
          ApiUtils.createApiResponse(message.id, null, "Method not supported"),
        );
        break;
    }
  } catch (error) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, RPC_ERRORS.INTERNAL_ERROR),
    );
  }
};
