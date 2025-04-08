import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { z } from "zod";

export const getUtxoAddress: Handler = async (
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

  const getUtxoAddressArgs = z.object({
    p2shAddress: z.string().optional(),
  });

  const parsedArgs = getUtxoAddressArgs.safeParse(message.payload);

  if (!parsedArgs.success) {
    return sendError(parsedArgs.error.toString());
  }

  // TODO
  sendResponse(ApiUtils.createApiResponse(message.id, "ADDR"));
};
