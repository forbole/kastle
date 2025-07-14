import {
  ApiRequestWithHost,
  RpcError,
  RPC_ERRORS,
  ApiResponseSchema,
} from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { isUserDeniedResponse } from "./utils";

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
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/connect`;
    url.searchParams.set("host", message.host);
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("name", message.host);

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
