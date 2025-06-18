import { z } from "zod";
import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "../../utils";

export const switchNetworkHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const result = z.string().safeParse(message.payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid Inputs"),
    );
    return;
  }

  const network = result.data;

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

  const settings = await ApiUtils.getSettings();
  if (settings.networkId === network) {
    sendResponse(ApiUtils.createApiResponse(message.id, settings.networkId));
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/kaspa/switch-network";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("network", network);

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  sendResponse(response);
};
