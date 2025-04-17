import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

export const getNetwork: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  const settings = await ApiUtils.getSettings();

  sendResponse(ApiUtils.createApiResponse(message.id, settings.networkId));
};
