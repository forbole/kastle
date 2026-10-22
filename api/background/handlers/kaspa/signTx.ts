import { Handler } from "@/api/background/utils";
import { ApiRequestWithHost, RPC_ERRORS } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { SignTxPayloadSchema, isCovenantTxJson } from "./utils";

/** signTxHandler to serve BrowserMessageType.SIGN_TX message */
export const signTxHandler: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
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

  // Check if host is connected, if not, return error
  if (!(await ApiUtils.isHostConnected(message.host))) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Host not connected"),
    );
    return;
  }

  const result = SignTxPayloadSchema.safeParse(message.payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid transaction data"),
    );
    return;
  }

  if (isCovenantTxJson(result.data.txJson)) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        RPC_ERRORS.COVENANT_TX_UNSUPPORTED,
      ),
    );
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/sign-tx";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("payload", JSON.stringify(result.data));
  if (message.host) {
    url.searchParams.set("origin", message.host);
  }

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  sendResponse(response);
};
