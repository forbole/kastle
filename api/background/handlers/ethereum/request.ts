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
import { signMessageHandler } from "./signMessage";
import { sendTransactionHandler } from "./sendTransaction";
import { signTypedDataV4Handler } from "./signTypedDataV4";
import { publicClientHandler, PUBLIC_CLIENT_METHODS } from "./publicClient";

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

  const { payload } = message;
  const result = RpcRequestSchema.safeParse(payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, RPC_ERRORS.INVALID_PARAMS),
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
      case ETHEREUM_METHODS.SIGN_MESSAGE:
        await signMessageHandler(tabId, message, sendResponse);
        break;
      case ETHEREUM_METHODS.SEND_TRANSACTION:
        await sendTransactionHandler(tabId, message, sendResponse);
        break;
      case ETHEREUM_METHODS.SIGN_TYPED_DATA_V4:
        await signTypedDataV4Handler(tabId, message, sendResponse);
        break;
      default:
        if (PUBLIC_CLIENT_METHODS.has(parsedPayload.method)) {
          await publicClientHandler(tabId, message, sendResponse);
          return;
        }

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
