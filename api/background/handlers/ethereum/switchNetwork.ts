import { z } from "zod";
import {
  ApiRequestWithHost,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "../../utils";
import { SUPPORTED_ETHEREUM_CHAINS } from "./utils";
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
  const result = z.array(switchNetworkPayloadSchema).safeParse(request.params);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid Inputs"),
    );
    return;
  }

  if (result.data.length < 1) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid Inputs"),
    );
    return;
  }
  const network = hexToNumber(result.data[0].chainId);

  const isSupported = SUPPORTED_ETHEREUM_CHAINS.some(
    (chain) => chain.id === network,
  );
  if (!isSupported) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        RPC_ERRORS.UNSUPPORTED_CHAIN,
      ),
    );
    return;
  }

  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        "Extension is not initialized",
      ),
    );
    return;
  }

  const settings = await ApiUtils.getSettings();
  if (settings.ethereumNetworkId === network) {
    sendResponse(ApiUtils.createApiResponse(message.id, settings.networkId));
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/ethereum/switch-network";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("network", network.toString());

  ApiUtils.openPopup(tabId, url.toString());
  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
