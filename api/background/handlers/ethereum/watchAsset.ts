import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";
import { isUserDeniedResponse } from "./utils";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "./utils";
import { numberToHex } from "viem";

export const erc20OptionsSchema = z.object({
  address: z.string().refine((val) => /^0x[a-fA-F0-9]{40}$/.test(val), {
    message: "Invalid ERC20 address",
  }),
  symbol: z.string().min(1, "Symbol is required"),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(255, "Decimals must be between 0 and 255"),
  image: z.string().optional(),
  chainId: z.string(),
});

export const watchAssetSchema = z.object({
  type: z.enum(["ERC20", "ERC721", "ERC1155"]),
  options: z.unknown(),
});

export const watchAssetHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: RpcError) {
    sendResponse(ApiUtils.createApiResponse(message.id, null, error));
  };

  const isConnected = await ApiUtils.isHostConnected(message.host);
  if (!isConnected) {
    sendError(RPC_ERRORS.UNAUTHORIZED);
    return;
  }

  const request = RpcRequestSchema.parse(message.payload);
  const { params } = request;
  if (!params || params.length < 1) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const payload = params[0];

  const result = watchAssetSchema.safeParse(payload);
  if (!result.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const parsedPayload = result.data;

  // TODO: Add support for ERC721 and ERC1155 in the future
  if (parsedPayload.type !== "ERC20") {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const settings = await ApiUtils.getSettings();
  const supportedChains =
    settings?.networkId === "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const erc20OptionsResult = erc20OptionsSchema.safeParse(
    parsedPayload.options,
  );
  if (!erc20OptionsResult.success) {
    sendError(RPC_ERRORS.UNSUPPORTED_CHAIN);
    return;
  }

  const isSupported = supportedChains.some((chain) => {
    return numberToHex(chain.id) === erc20OptionsResult.data.chainId;
  });
  if (!isSupported) {
    sendError(RPC_ERRORS.UNSUPPORTED_CHAIN);
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/ethereum/watch-asset`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set(
    "payload",
    encodeURIComponent(JSON.stringify(parsedPayload)),
  );

  ApiUtils.openPopup(tabId, url.toString());

  // Wait for the response from the popup
  const response = await ApiUtils.receiveExtensionMessage(message.id);
  if (isUserDeniedResponse(response)) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        RPC_ERRORS.USER_REJECTED_REQUEST,
      ),
    );
    return;
  }

  sendResponse(response);
};
