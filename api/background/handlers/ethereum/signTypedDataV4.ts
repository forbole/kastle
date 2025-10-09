import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";
import { isMatchCurrentAddress, isUserDeniedResponse } from "./utils";
import { signTypedDataSchema } from "@/lib/service/handlers/evm/evm-sign-typed-data";

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
  if (!Array.isArray(request.params) || request.params.length < 2) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const { params } = request;
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
  const result = signTypedDataSchema.safeParse(payload);
  if (!result.success) {
    sendError(RPC_ERRORS.INVALID_PARAMS);
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/ethereum/sign-typed-data-v4`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set(
    "payload",
    encodeURIComponent(JSON.stringify(result.data)),
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
