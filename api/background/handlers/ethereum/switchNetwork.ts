import { z } from "zod";
import {
  ApiRequestWithHost,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "../../utils";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
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
  if (!request.params || request.params.length < 1) {
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
  const supported =
    settings.networkId === "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const isSupported = supported.some((chain) => chain.id === network);
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

  if (settings.evmL2ChainId?.[settings.networkId] === network) {
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
