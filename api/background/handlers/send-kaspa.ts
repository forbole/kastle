import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { z } from "zod";

export const sendKaspa: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  const sendError = (error: string) => {
    sendResponse(ApiUtils.createApiResponse(message.id, false, error));
  };
  const error = await ApiUtils.isWalletReady(message.host);
  if (error) {
    return sendError(error);
  }

  const sendKaspaArgs = z.object({
    toAddress: z.string(),
    amountSompi: z.number().int().positive(),
    options: z.object({
      priorityFee: z.number().optional(),
    }),
  });

  const parsedArgs = sendKaspaArgs.safeParse(message.payload);

  if (!parsedArgs.success) {
    return sendError(parsedArgs.error.toString());
  }

  // FIXME help from Paul?
  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/sign-and-broadcast-tx";
  url.searchParams.set("requestId", message.id);
  // url.searchParams.set("payload", JSON.stringify(result.data));

  ApiUtils.openPopup(tabId, url.toString());

  const response = await ApiUtils.receiveExtensionMessage(message.id);
  sendResponse(response);
};
