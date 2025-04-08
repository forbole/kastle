import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { z } from "zod";

export const switchNetwork: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  const sendError = (error: string) => {
    sendResponse(ApiUtils.createApiResponse(message.id, false, error));
  };
  const error = await ApiUtils.isWalletReady();
  if (error) {
    return sendError(error);
  }

  const switchNetworkArgs = z.object({
    network: z.union([z.literal("mainnet"), z.literal("testnet-10")]),
    name: z.string().optional(),
    icon: z.string().optional(),
  });

  const parsedArgs = switchNetworkArgs.safeParse(message.payload);

  if (!parsedArgs.success) {
    return sendError(parsedArgs.error.toString());
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `/connect`;
  url.searchParams.set("host", message.host);
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("network", parsedArgs.data.network);
  if (parsedArgs.data.name) {
    url.searchParams.set("name", parsedArgs.data.name);
  }
  if (parsedArgs.data.icon) {
    url.searchParams.set("icon", parsedArgs.data.icon);
  }

  ApiUtils.openPopup(tabId, url.toString());

  const response = await ApiUtils.receiveExtensionMessage(message.id);

  sendResponse(response);
};
