import { Handler } from "@/api/background/utils";
import { ApiRequest, ApiResponse, SignMessagePayload } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";

/** signMessageHandler to serve BrowserMessageType.SIGN_MESSAGE message */
export const signMessageHandler: Handler = async (
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

  if (!SignMessagePayload.validate(message.payload)) {
    sendResponse(new ApiResponse(message.id, null, "Invalid payload"));
    return;
  }

  // Reconstruct SignMessagePayload from serialized message data to restore methods
  const payload = Object.assign(new SignMessagePayload(""), message.payload);

  const url = browser.runtime.getURL(
    `/popup.html?requestId=${encodeURIComponent(message.id)}&payload=${payload.toUriString()}#/sign-message`,
  );

  ApiUtils.openPopup(tabId, url);

  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
