import { Handler } from "@/api/background/utils";
import { ApiRequestWithHost, ApiResponse } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";

export const SignMessagePayloadSchema = z
  .string()
  .min(1, "Message cannot be empty");

export type SignMessagePayload = z.infer<typeof SignMessagePayloadSchema>;

// ================================================================================

/** signMessageHandler to serve BrowserMessageType.SIGN_MESSAGE message */
export const signMessageHandler: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  if (!message.host) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Host is required"),
    );
    return;
  }

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

  const result = SignMessagePayloadSchema.safeParse(message.payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid message data"),
    );
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/sign-message";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("payload", encodeURIComponent(result.data));

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  sendResponse(response);
};
