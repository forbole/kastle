import { isKeyringInitialized } from "@/api/background/keyring-status";
import { ApiRequestWithHost, RPC_ERRORS } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { Address, createTransactions } from "@/wasm/core/kaspa";
import { SignTxPayloadSchema } from "./utils";

import { parseKaspaSendRequest } from "@/lib/kaspa-send-request";
export { sendSompiPayloadSchema } from "@/lib/kaspa-send-request";

const ADDRESS_PREFIX_MAP = {
  mainnet: "kaspa",
  "testnet-10": "kaspatest",
};

export async function sendSompiHandler(
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: any,
) {
  if (!message.host) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Host is required"),
    );
    return;
  }

  // Check if extension is initialized
  if (!(await isKeyringInitialized())) {
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

  let parsed: ReturnType<typeof parseKaspaSendRequest>;
  try {
    parsed = parseKaspaSendRequest(message.payload);
  } catch (error) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, `Invalid payload: ${error}`),
    );
    return;
  }

  const networkId = (await ApiUtils.getSettings()).networkId;
  for (const output of parsed.outputs) {
    if (
      !Address.validate(output.address) ||
      new Address(output.address).prefix !== ADDRESS_PREFIX_MAP[networkId]
    ) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "Invalid output address or network",
        ),
      );
      return;
    }
  }

  // Get sender address
  const sender = await ApiUtils.getCurrentAccount();

  if (!sender) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "No account found"),
    );
    return;
  }

  const rpcClient = await ApiUtils.getKaspaRpcClient();
  try {
    await rpcClient.connect();

    // Get utxos
    const { entries } = await rpcClient.getUtxosByAddresses([sender.address]);
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

    // Create transaction and open signAndBroadcastTx popup
    const { transactions: pendingTxs } = await createTransactions({
      entries,
      outputs: parsed.outputs.map((output) => ({
        address: output.address,
        amount: BigInt(output.amount),
      })),
      priorityFee: BigInt(parsed.options.priorityFee),
      changeAddress: sender.address,
      payload: parsed.options?.payload,
      networkId,
    });
    if (pendingTxs.length === 0) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "Failed to create transaction",
        ),
      );
      return;
    }

    // Fail closed: the popup signs one transaction, and [0] of a batch is a
    // compounding transaction that pays the recipient nothing.
    if (pendingTxs.length > 1) {
      sendResponse(
        ApiUtils.createApiResponse(message.id, null, RPC_ERRORS.BATCH_REQUIRED),
      );
      return;
    }

    const pendingTx = pendingTxs[0];

    // Open sign and broadcast popup
    const result = SignTxPayloadSchema.parse({
      networkId,
      txJson: pendingTx.transaction.serializeToSafeJSON(),
    });

    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = "/sign-and-broadcast-tx";
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("payload", JSON.stringify(result));

    // Open the popup and wait for the response
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
        `Failed to send kaspa: ${error}`,
      ),
    );
    return;
  } finally {
    await rpcClient.disconnect();
  }
}
