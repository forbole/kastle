import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

export const getWalletAddress: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  const sendError = (error: string) => {
    sendResponse(ApiUtils.createApiResponse(message.id, false, error));
  };
  const error = await ApiUtils.isWalletReady(message.host);
  if (error) {
    return sendError(error);
  }

  const account = await ApiUtils.getCurrentAccount();
  if (!account) {
    return sendError("No account found");
  }

  if (!account.address) {
    return sendError("No address found");
  }

  sendResponse(ApiUtils.createApiResponse(message.id, account.address));
};
