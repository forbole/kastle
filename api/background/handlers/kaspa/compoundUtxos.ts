import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { z } from "zod";
import { createTransactions } from "@/wasm/core/kaspa";
import { SignTxPayloadSchema } from "./utils";

export const compoundUtxosPayloadSchema = z.object({
  priorityFee: z.string().default("0"),
});

export type CompoundUtxosPayload = z.infer<typeof compoundUtxosPayloadSchema>;

/**
 * compoundUtxos handler - consolidates all UTXOs into a single UTXO by
 * sending the full balance back to the sender's own address.
 */
export const compoundUtxosHandler: Handler = async (
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

  // Check if host is connected
  if (!(await ApiUtils.isHostConnected(message.host))) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Host not connected"),
    );
    return;
  }

  const result = compoundUtxosPayloadSchema.safeParse(message.payload ?? {});
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        `Invalid payload: ${result.error.message}`,
      ),
    );
    return;
  }

  const parsed = result.data;

  const account = await ApiUtils.getCurrentAccount();
  if (!account?.address) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "No account found"),
    );
    return;
  }

  const networkId = (await ApiUtils.getSettings()).networkId;
  const rpcClient = await ApiUtils.getKaspaRpcClient();

  try {
    await rpcClient.connect();

    const { entries } = await rpcClient.getUtxosByAddresses([account.address]);

    if (entries.length === 0) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "No UTXOs found for the address",
        ),
      );
      return;
    }

    if (entries.length === 1) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "Already have a single UTXO, nothing to compound",
        ),
      );
      return;
    }

    // Build a compounding transaction with no explicit outputs.
    // createTransactions will consolidate all UTXOs and return the net
    // amount (total minus fees) to changeAddress automatically.
    const { transactions: pendingTxs } = await createTransactions({
      entries,
      outputs: [],
      priorityFee: BigInt(parsed.priorityFee),
      changeAddress: account.address,
      networkId,
    });

    if (pendingTxs.length === 0) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "Failed to build compound transaction",
        ),
      );
      return;
    }

    const pendingTx = pendingTxs[0];

    // Open sign and broadcast popup
    const signPayload = SignTxPayloadSchema.safeParse({
      networkId,
      txJson: pendingTx.transaction.serializeToSafeJSON(),
    });

    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = "/sign-and-broadcast-tx";
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("payload", JSON.stringify(signPayload.data));

    const response = await ApiUtils.openPopupAndListenForResponse(
      message.id,
      url.toString(),
      tabId,
    );
    sendResponse(response);
  } catch (error) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        `Failed to compound UTXOs: ${error}`,
      ),
    );
  } finally {
    await rpcClient.disconnect();
  }
};
