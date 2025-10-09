import { z } from "zod";
import {
  ApiRequestWithHost,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "../../utils";
import { isHex, hexToNumber } from "viem";

export const switchNetworkPayloadSchema = z.object({
  chainId: z.string().refine(isHex),
});

export const switchNetworkHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const request = RpcRequestSchema.parse(message.payload);
  if (!Array.isArray(request.params) || request.params.length < 1) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, RPC_ERRORS.INVALID_PARAMS),
    );
    return;
  }

  const payload = request.params[0];
  const result = switchNetworkPayloadSchema.safeParse(payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, RPC_ERRORS.INVALID_PARAMS),
    );
    return;
  }

  const network = hexToNumber(result.data.chainId);
  const settings = await ApiUtils.getSettings();
  if (settings.evmL2ChainId?.[settings.networkId] === network) {
    sendResponse(ApiUtils.createApiResponse(message.id, network));
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/ethereum/switch-network";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("network", network.toString());

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  sendResponse(response);
};
