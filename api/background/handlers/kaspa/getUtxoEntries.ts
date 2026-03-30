import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";

/** getUtxoEntries handler to serve Action.GET_UTXO_ENTRIES message */
export const getUtxoEntriesHandler: Handler = async (
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
      const utxoResponse = await rpcClient.getUtxosByAddresses({
        addresses: [account.address],
      });

      const entries = utxoResponse.entries.map((entry) => ({
        address: entry.address?.toString(),
        outpoint: {
          transactionId: entry.outpoint.transactionId,
          index: entry.outpoint.index,
        },
        amount: entry.amount.toString(),
        scriptPublicKey: entry.scriptPublicKey.toString(),
        blockDaaScore: entry.blockDaaScore.toString(),
        isCoinbase: entry.isCoinbase,
      }));

      sendResponse(ApiUtils.createApiResponse(message.id, { entries }));
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
