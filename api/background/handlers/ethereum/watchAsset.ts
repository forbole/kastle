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
import { numberToHex, isHex, isAddress } from "viem";
import { NetworkType } from "@/contexts/SettingsContext";

export const erc20OptionsSchema = z.object({
  address: z.string().refine(isAddress),
  symbol: z.string().min(1, "Symbol is required"),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(255, "Decimals must be between 0 and 255"),
  image: z.string().optional(),
  chainId: z.string().refine(isHex).optional(),
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

  let payload: unknown;
  const request = RpcRequestSchema.parse(message.payload);
  const { params } = request;
  if (Array.isArray(params) && params.length > 0) {
    payload = params[0];
  } else {
    payload = request.params;
  }

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

  const erc20OptionsResult = erc20OptionsSchema.safeParse(
    parsedPayload.options,
  );
  if (!erc20OptionsResult.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const erc20Options = erc20OptionsResult.data;

  const settings = await ApiUtils.getSettings();
  if (erc20Options.chainId) {
    const supportedChains =
      settings?.networkId === "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

    const isSupported = supportedChains.some((chain) => {
      return numberToHex(chain.id) === erc20Options.chainId;
    });
    if (!isSupported) {
      sendError(RPC_ERRORS.UNSUPPORTED_CHAIN);
      return;
    }
  } else {
    const evmChainId = settings.evmL2ChainId?.[settings.networkId];
    if (!evmChainId) {
      sendError(RPC_ERRORS.UNSUPPORTED_CHAIN);
      return;
    }

    erc20Options.chainId = numberToHex(evmChainId);
    parsedPayload.options = erc20Options;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/ethereum/watch-asset`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set(
    "payload",
    encodeURIComponent(JSON.stringify(parsedPayload)),
  );

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
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
