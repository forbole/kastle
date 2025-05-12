import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequest, ApiRequestWithHost } from "@/api/message";

/** getAccount handler to serve BrowserMessageType.GET_ADDRESS message */
export const getAccountHandler: Handler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) => {
  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        false,
        "Extension is not initialized",
      ),
    );
    return;
  }

  // Check if host is connected, if not, return error
  if (!(await ApiUtils.isHostConnected(message.host))) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, false, "Host not connected"),
    );
    return;
  }

  try {
    const account = await ApiUtils.getCurrentAccount();
    if (!account) {
      throw new Error("No account found");
    }

    if (!account.address || !account.publicKeys) {
      throw new Error("No address or public key found");
    }

    sendResponse(
      ApiUtils.createApiResponse(message.id, {
        address: account.address,
        publicKey: account.publicKeys[0],
      }),
    );
  } catch (error) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        false,
        (error as Error).toString(),
      ),
    );
    return;
  }
};
