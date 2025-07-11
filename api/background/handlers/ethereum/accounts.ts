import { RpcError, ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";

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

  const ethAddress = await ApiUtils.getEvmAddress();
  sendResponse(
    ApiUtils.createApiResponse(message.id, ethAddress ? [ethAddress] : []),
  );
};
