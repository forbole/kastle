import { Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { SignTxPayloadSchema, isCovenantTxJson } from "./utils";
import { covenantAdmission } from "./covenant-guard";

/** signAndBroadcastTx handler to serve BrowserMessageType.SIGN_AND_BROADCAST_TX message */
export const signAndBroadcastTxHandler: Handler = async (
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

  const result = SignTxPayloadSchema.safeParse(message.payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid transaction data"),
    );
    return;
  }

  // Version 0 never fetches; a covenant request opens only once every input
  // it signs is checked.
  // The admission is bound to the account it ran for (admittedFor); any value
  // the dApp sent is overwritten, and dropped for version 0.
  const admission = isCovenantTxJson(result.data.txJson)
    ? await covenantAdmission(result.data.txJson, result.data.scripts)
    : undefined;
  if (admission && "refusal" in admission) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, admission.refusal),
    );
    return;
  }
  const payload = { ...result.data, admittedFor: admission?.admittedFor };

  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/sign-and-broadcast-tx";
  url.searchParams.set("requestId", message.id);
  url.searchParams.set("payload", JSON.stringify(payload));
  url.searchParams.set("origin", message.host);

  // Open the popup and wait for the response
  const response = await ApiUtils.openPopupAndListenForResponse(
    message.id,
    url.toString(),
    tabId,
  );
  sendResponse(response);
};
