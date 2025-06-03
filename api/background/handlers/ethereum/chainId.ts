import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { numberToHex } from "viem";

export const chainIdHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const settings = await ApiUtils.getSettings();
  sendResponse(
    ApiUtils.createApiResponse(message.id, numberToHex(settings.evmL2ChainId)),
  );
};
