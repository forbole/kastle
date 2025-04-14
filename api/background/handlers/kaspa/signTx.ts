import { Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { SignTxPayloadSchema } from "./utils";

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

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/sign-tx";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("payload", JSON.stringify(result.data));

  ApiUtils.openPopup(tabId, url.toString());

  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
