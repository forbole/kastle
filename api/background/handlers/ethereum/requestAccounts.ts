import { ApiRequest, ApiResponse, RpcError, RPC_ERRORS } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";

export const requestAccountsHandler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: RpcError) {
    // NOTE: can not send undefined as response, so send null
    sendResponse(new ApiResponse(message.id, null, error));
  };

  if (!message.host) {
    // TODO: use proper
    sendError(RPC_ERRORS.USER_REJECTED_REQUEST);
    return;
  }

  const isConnected = await ApiUtils.isHostConnected(message.host);
  if (!isConnected) {
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/connect`;
    url.searchParams.set("host", message.host);
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("name", message.host);
    url.searchParams.set("icon", "");

    ApiUtils.openPopup(tabId, url.toString());

    const result = (await ApiUtils.receiveExtensionMessage(
      message.id,
    )) as ApiResponse<Boolean>;
    const isConnected = result.response;
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
    // TODO: use proper error
    sendError(RPC_ERRORS.USER_REJECTED_REQUEST);
    return;
  }

  const publicKey = account.publicKeys[0];
  const ethAddress = publicKeyToAddress(`0x${publicKey}` as `0x${string}`);
  sendResponse(new ApiResponse(message.id, [ethAddress]));
};
