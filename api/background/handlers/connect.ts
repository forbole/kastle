import { ApiRequest, ApiResponse, ConnectPayload } from "@/api/message";
import { ApiUtils, Handler } from "@/api/background/utils";

/** Connect handler to serve BrowserMessageType.CONNECT message */
export const connectHandler: Handler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: string) {
    // NOTE: can not send undefined as response, so send null
    sendResponse(new ApiResponse(message.id, null, error));
  };

  if (!message.host) {
    sendError("Host is required");
    return;
  }

  const { payload } = message;
  if (!ConnectPayload.validate(payload)) {
    sendError("Invalid payload");
    return;
  }

  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendError("Extension is not initialized");
    return;
  }

  // Check if connection is already existing
  if (await ApiUtils.isHostConnected(message.host)) {
    sendResponse(new ApiResponse(message.id, true));
    return;
  }

  // Check if networkId matches
  if (!(await ApiUtils.matchNetworkId(payload.networkId))) {
    sendError(
      "Network ID does not match, please change network to " +
        payload.networkId,
    );
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/connect`;
  url.searchParams.set("host", message.host);
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("name", payload.name);
  url.searchParams.set("icon", payload.icon ?? "");

  browser.windows.create({
    tabId,
    type: "popup",
    url: url.toString(),
    width: 375,
    height: 600,
    focused: true,
  });

  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
