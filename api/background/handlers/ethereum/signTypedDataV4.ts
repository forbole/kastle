import { type SignTypedDataParameters } from "viem/accounts";
import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";
import { isMatchCurrentAddress } from "./utils";

export const signTypedDataV4Handler = async (
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
  if (params.length < 2) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const fromAddress = params[0];
  const addressResult = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .safeParse(fromAddress);
  if (!addressResult.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }
  const isMatch = await isMatchCurrentAddress(addressResult.data);
  if (!isMatch) {
    sendError(RPC_ERRORS.UNAUTHORIZED);
    return;
  }

  const payload = params[1];
  const schema = z.any() as z.ZodType<SignTypedDataParameters>;
  const result = schema.safeParse(payload);
  if (!result.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const transaction = result.data;
  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/ethereum/sign-transaction`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set(
    "payload",
    encodeURIComponent(JSON.stringify(transaction)),
  );

  ApiUtils.openPopup(tabId, url.toString());

  // Wait for the response from the popup
  const ApiExtensionResponse = await ApiUtils.receiveExtensionMessage(
    message.id,
  );
  sendResponse(ApiExtensionResponse);
};
