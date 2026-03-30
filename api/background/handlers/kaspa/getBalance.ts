import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

/** getBalance handler to serve Action.GET_BALANCE message */
export const getBalanceHandler: Handler = async (
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

    if (!account.address) {
      throw new Error("No address found");
    }

    const rpcClient = await ApiUtils.getKaspaRpcClient();
    await rpcClient.connect();

    try {
      const balanceResponse = await rpcClient.getBalanceByAddress({
        address: account.address,
      });

      sendResponse(
        ApiUtils.createApiResponse(message.id, {
          balance: balanceResponse.balance.toString(),
        }),
      );
    } finally {
      await rpcClient.disconnect();
    }
  } catch (error) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        false,
        (error as Error).toString(),
      ),
    );
  }
};
