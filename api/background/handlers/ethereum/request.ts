import { Handler } from "@/api/background/utils";
import {
  RpcRequestSchema,
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
import { switchNetworkHandler } from "./switchNetwork";
import { watchAssetHandler } from "./watchAsset";

enum ETHEREUM_METHODS {
  REQUEST_ACCOUNTS = "eth_requestAccounts",
  CHAIN_ID = "eth_chainId",
  ACCOUNTS = "eth_accounts",
  SEND_TRANSACTION = "eth_sendTransaction",
  SIGN_MESSAGE = "personal_sign",
  SIGN_TYPED_DATA_V4 = "eth_signTypedData_v4",
  WALLET_SWITCH_ETHEREUM_NETWORK = "wallet_switchEthereumChain",
  WALLET_WATCH_ASSET = "wallet_watchAsset",
}

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
      case ETHEREUM_METHODS.WALLET_SWITCH_ETHEREUM_NETWORK:
        await switchNetworkHandler(tabId, message, sendResponse);
        break;
      case ETHEREUM_METHODS.WALLET_WATCH_ASSET:
        await watchAssetHandler(tabId, message, sendResponse);
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
