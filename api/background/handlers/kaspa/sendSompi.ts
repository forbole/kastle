import { ApiRequestWithHost } from "@/api/message";
import { z } from "zod";
import { ApiUtils } from "@/api/background/utils";
import { Address, kaspaToSompi, createTransactions } from "@/wasm/core/kaspa";
import { SignTxPayloadSchema } from "./utils";

export const sendSompiPayloadSchema = z.object({
  toAddress: z.string().min(1, "toAddress cannot be empty"),
  sompi: z
    .number()
    .min(Number(0.2 * 10 ** 8), "sompi must be greater than 0.2 KAS"),
  options: z
    .object({
      priorityFee: z
        .number()
        .min(0, "priorityFee must be greater than or equal to 0")
        .default(0),
      payload: z.string().optional(),
    })
    .default({}),
});

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

  const result = sendSompiPayloadSchema.safeParse(message.payload);
  if (!result.success) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid transaction data"),
    );
    return;
  }

  // Validate toAddress, network prefix
  const parsed = result.data;

  const networkId = (await ApiUtils.getSettings()).networkId;
  const isValidated = Address.validate(parsed.toAddress);
  if (!isValidated) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid toAddress"),
    );
    return;
  }

  const parsedAddress = new Address(parsed.toAddress);
  if (parsedAddress.prefix !== ADDRESS_PREFIX_MAP[networkId]) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "Invalid toAddress"),
    );
    return;
  }

  // Get sender address
  const sender = await ApiUtils.getCurrentAccount();

  if (!sender) {
    throw new Error("No account found");
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
      outputs: [
        {
          address: parsed.toAddress,
          amount: BigInt(parsed.sompi),
        },
      ],
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

    const pendingTx = pendingTxs[0];

    // Open sign and broadcast popup
    const result = SignTxPayloadSchema.safeParse({
      networkId,
      txJson: pendingTx.transaction.serializeToSafeJSON(),
    });

    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = "/sign-and-broadcast-tx";
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("payload", JSON.stringify(result.data));

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
