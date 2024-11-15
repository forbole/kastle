import { Handler } from "@/api/background/utils";
import { ApiRequest, ApiResponse, TransactionPayload } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";

/** signAndBroadcastTx handler to serve BrowserMessageType.SIGN_AND_BROADCAST_TX message */
export const signAndBroadcastTxHandler: Handler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: any,
) => {
  if (!message.host) {
    sendResponse(new ApiResponse(message.id, null, "Host is required"));
    return;
  }

  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendResponse(
      new ApiResponse(message.id, null, "Extension is not initialized"),
    );
    return;
  }

  // Check if host is connected, if not, return error
  if (!(await ApiUtils.isHostConnected(message.host))) {
    sendResponse(new ApiResponse(message.id, null, "Host not connected"));
    return;
  }

  if (!TransactionPayload.validate(message.payload)) {
    sendResponse(new ApiResponse(message.id, null, "Invalid transaction data"));
    return;
  }

  // Reconstruct TransactionMessage from serialized message data to restore methods
  const transaction = Object.assign(
    new TransactionPayload("", []),
    message.payload,
  );

  browser.windows.create({
    tabId,
    type: "popup",
    url: browser.runtime.getURL(
      `/popup.html?requestId=${encodeURIComponent(message.id)}&payload=${encodeURIComponent(transaction.toBase64Url())}#/signAndBroadcastTx`,
    ),
    width: 375,
    height: 600,
    focused: true,
  });

  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
