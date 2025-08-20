import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  ApiResponseSchema,
  RpcRequestSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { isUserDeniedResponse } from "./utils";
import { z } from "zod";

export const ConnectPayloadSchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
});

export const requestAccountsHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: RpcError) {
    // NOTE: can not send undefined as response, so send null
    sendResponse(ApiUtils.createApiResponse(message.id, null, error));
  };

  const isConnected = await ApiUtils.isHostConnected(message.host);
  const isEvmPublicKeyMigrated = !!(await ApiUtils.getEvmAddress());
  if (!isConnected || !isEvmPublicKeyMigrated) {
    const request = RpcRequestSchema.parse(message.payload);
    if (!Array.isArray(request.params) || request.params.length < 1) {
      sendError(RPC_ERRORS.INVALID_PARAMS);
      return;
    }

    const { params } = request;
    const payload = ConnectPayloadSchema.safeParse(params[0]);
    if (!payload.success) {
      sendError(RPC_ERRORS.INVALID_PARAMS);
      return;
    }
    const parsedPayload = payload.data;

    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/connect`;
    url.searchParams.set("host", message.host);
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("name", parsedPayload.name);
    url.searchParams.set("icon", parsedPayload.icon ?? "");

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

    const result = ApiResponseSchema.safeParse(response);
    if (!result.success) {
      sendError(RPC_ERRORS.INTERNAL_ERROR);
      return;
    }

    const isConnected = result.data.response as boolean;
    if (!isConnected) {
      sendError(RPC_ERRORS.USER_REJECTED_REQUEST);
      return;
    }
  }

  const ethAddress = await ApiUtils.getEvmAddress();
  sendResponse(
    ApiUtils.createApiResponse(message.id, ethAddress ? [ethAddress] : []),
  );
};
