import { RpcError, ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { toEvmAddress } from "@/lib/utils";

export const accountsHandler = async (
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
    sendResponse(ApiUtils.createApiResponse(message.id, []));
    return;
  }

  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    sendResponse(ApiUtils.createApiResponse(message.id, []));
    return;
  }

  const publicKey = account.publicKeys[0];
  const ethAddress = toEvmAddress(publicKey);
  sendResponse(ApiUtils.createApiResponse(message.id, [ethAddress]));
};
