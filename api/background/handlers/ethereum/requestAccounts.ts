import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  ApiResponse,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";

export const requestAccountsHandler = async (
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
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/connect`;
    url.searchParams.set("host", message.host);
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("name", message.host);
    url.searchParams.set("icon", "");

    ApiUtils.openPopup(tabId, url.toString());

    const extensionResponse: ApiResponse =
      await ApiUtils.receiveExtensionMessage(message.id);

    const isConnected = extensionResponse.response;
    if (!isConnected) {
      sendError(RPC_ERRORS.USER_REJECTED_REQUEST);
      return;
    }
  }

  const isUnlocked = ApiUtils.isUnlocked();
  if (!isUnlocked) {
    sendError(RPC_ERRORS.UNAUTHORIZED);
    return;
  }

  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    sendError(RPC_ERRORS.INTERNAL_ERROR);
    return;
  }

  const publicKey = account.publicKeys[0];
  const ethAddress = publicKeyToAddress(`0x${publicKey}` as `0x${string}`);
  sendResponse(ApiUtils.createApiResponse(message.id, [ethAddress]));
};
