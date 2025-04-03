import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";

export const chainIdHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  // TODO: read ethereum chainId from the settings, now returns Goerli chainId
  sendResponse(ApiUtils.createApiResponse(message.id, "0x5"));
};
