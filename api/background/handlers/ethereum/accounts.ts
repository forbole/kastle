import { ApiRequest, ApiResponse, RpcError, RPC_ERRORS } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";

export const accountsHandler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: RpcError) {
    // NOTE: can not send undefined as response, so send null
    sendResponse(new ApiResponse(message.id, null, error));
  };

  if (!message.host) {
    return;
  }

  const isConnected = await ApiUtils.isHostConnected(message.host);
  const isUnlocked = ApiUtils.isUnlocked();
  if (!isConnected || !isUnlocked) {
    sendResponse(new ApiResponse(message.id, []));
    return;
  }

  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    sendResponse(new ApiResponse(message.id, []));
    return;
  }

  const publicKey = account.publicKeys[0];
  const ethAddress = publicKeyToAddress(`0x${publicKey}` as `0x${string}`);
  sendResponse(new ApiResponse(message.id, [ethAddress]));
};
