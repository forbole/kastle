import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

export const getPublicKey: Handler = async (
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
  const publicKey = account?.publicKeys?.[0];

  if (!publicKey) {
    return sendError("Missing public key");
  }

  sendResponse(ApiUtils.createApiResponse(message.id, publicKey));
};
