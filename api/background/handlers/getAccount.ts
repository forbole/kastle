import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequest, ApiResponse } from "@/api/message";

/** getAccount handler to serve BrowserMessageType.GET_ADDRESS message */
export const getAccountHandler: Handler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: any,
) => {
  if (!message.host) {
    sendResponse(new ApiResponse(message.id, false, "Host is required"));
    return;
  }

  // Check if extension is initialized
  if (!(await ApiUtils.isInitialized())) {
    sendResponse(
      new ApiResponse(message.id, false, "Extension is not initialized"),
    );
    return;
  }

  // Check if host is connected, if not, return error
  if (!(await ApiUtils.isHostConnected(message.host))) {
    sendResponse(new ApiResponse(message.id, false, "Host not connected"));
    return;
  }

  // Check if wallet is unlocked
  if (!ApiUtils.isUnlocked()) {
    sendResponse(new ApiResponse(message.id, false, "Wallet is locked"));
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
      new ApiResponse(message.id, {
        address: account.address,
        publicKey: account.publicKeys[0],
      }),
    );
  } catch (error) {
    sendResponse(
      new ApiResponse(message.id, false, (error as Error).toString()),
    );
    return;
  }
};
