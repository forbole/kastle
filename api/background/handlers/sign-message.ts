import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

export const signMessage: Handler = async (
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

  // TODO
  sendResponse(ApiUtils.createApiResponse(message.id, "PK"));
};
