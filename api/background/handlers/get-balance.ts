import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

export const getBalance: Handler = async (
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

  // TODO Need Paul's review
  sendResponse(
    ApiUtils.createApiResponse(
      message.id,
      parseFloat(account?.balance ?? "0") * Math.pow(10, 8),
    ),
  );
};
