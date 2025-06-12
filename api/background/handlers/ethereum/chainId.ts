import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { numberToHex } from "viem";

export const chainIdHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const settings = await ApiUtils.getSettings();
  const chainId = settings.evmL2ChainId?.[settings.networkId] ?? 1; // Default to the mainnet if not set

  sendResponse(ApiUtils.createApiResponse(message.id, numberToHex(chainId)));
};
