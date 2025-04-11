import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  ApiResponseSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";
import { uncompressPublicKey } from "./utils";

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

    const extensionResponse = await ApiUtils.receiveExtensionMessage(
      message.id,
    );

    const result = ApiResponseSchema.safeParse(extensionResponse);
    if (!result.success) {
      sendError(RPC_ERRORS.INTERNAL_ERROR);
      return;
    }

    const isConnected = result.data.response as boolean;
    if (!isConnected) {
      sendError(RPC_ERRORS.USER_REJECTED_REQUEST);
      return;
    }
  }

  const isUnlocked = ApiUtils.isUnlocked();
  if (!isUnlocked) {
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/unlocked`;
    url.searchParams.set("requestId", message.id);

    ApiUtils.openPopup(tabId, url.toString());
    const extensionResponse = await ApiUtils.receiveExtensionMessage(
      message.id,
    );

    const result = ApiResponseSchema.safeParse(extensionResponse);
    if (!result.success) {
      sendError(RPC_ERRORS.INTERNAL_ERROR);
      return;
    }

    const isUnlocked = result.data.response as boolean;
    if (!isUnlocked) {
      sendError(RPC_ERRORS.USER_REJECTED_REQUEST);
      return;
    }
  }

  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys || account.publicKeys.length === 0) {
    sendError(RPC_ERRORS.INTERNAL_ERROR);
    return;
  }

  const publicKey = account.publicKeys[0];
  const uncompressedHex = uncompressPublicKey(publicKey);
  const ethAddress = publicKeyToAddress(uncompressedHex);
  sendResponse(ApiUtils.createApiResponse(message.id, [ethAddress]));
};
