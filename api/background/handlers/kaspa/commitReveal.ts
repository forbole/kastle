import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils, Handler } from "@/api/background/utils";
import { z } from "zod";
import { NetworkType } from "@/contexts/SettingsContext";

export const CommitRevealPayloadSchema = z.object({
  networkId: z.enum([NetworkType.Mainnet, NetworkType.TestnetT10]),
  namespace: z.string(),
  data: z.string(),
  options: z.object({
    revealPriorityFee: z.string().optional(),
  }),
});

export type CommitRevealPayload = z.infer<typeof CommitRevealPayloadSchema>;

export const commitRevealHandler: Handler = async (
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
  const result = CommitRevealPayloadSchema.safeParse(payload);
  if (!result.success) {
    sendError("Invalid payload");
    return;
  }

  const parsedPayload = result.data;
  // Check if host is connected
  if (!(await ApiUtils.isHostConnected(message.host))) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Host not connected"),
    );
    return;
  }

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = `kaspa/commit-reveal`;
  url.searchParams.set("requestId", message.id);
  url.searchParams.set(
    "payload",
    encodeURIComponent(JSON.stringify(parsedPayload)),
  );

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  sendResponse(response);
};
