import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils, Handler } from "@/api/background/utils";
import { NetworkType } from "@/contexts/SettingsContext";
import { z } from "zod";

export const ConnectPayloadSchema = z.object({
  networkId: z.nativeEnum(NetworkType),
  name: z.string(),
  icon: z.string().optional(),
});

export type ConnectPayload = z.infer<typeof ConnectPayloadSchema>;

/** Connect handler to serve BrowserMessageType.CONNECT message */
export const connectHandler: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const sendError = function (error: string) {
    // NOTE: can not send undefined as response, so send null
    sendResponse(ApiUtils.createApiResponse(message.id, null, error));
  };

  if (!message.host) {
    sendError("Host is required");
    return;
  }

  const { payload } = message;
  const result = ConnectPayloadSchema.safeParse(payload);
  if (!result.success) {
    sendError("Invalid payload");
    return;
  }
  const parsedPayload = result.data;

  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendError("Extension is not initialized");
    return;
  }

  // Check if connection is already existing
  if (
    await ApiUtils.isHostConnectedWithNetworkId(
      message.host,
      parsedPayload.networkId,
    )
  ) {
    sendResponse(ApiUtils.createApiResponse(message.id, true));
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/connect`;
  url.searchParams.set("host", message.host);
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("network", parsedPayload.networkId);
  url.searchParams.set("name", parsedPayload.name);
  url.searchParams.set("icon", parsedPayload.icon ?? "");

  ApiUtils.openPopup(tabId, url.toString());

  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
