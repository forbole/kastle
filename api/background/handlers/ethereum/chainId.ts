import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { kaia } from "viem/chains";
import { numberToHex } from "viem";

export const chainIdHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  // TODO: read ethereum chainId from the settings, now returns kaia chainId
  sendResponse(ApiUtils.createApiResponse(message.id, numberToHex(kaia.id)));
};
