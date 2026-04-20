import { ApiUtils, Handler } from "@/api/background/utils";
import { ApiRequestWithHost } from "@/api/message";
import { z } from "zod";
import { Address, createTransactions } from "@/wasm/core/kaspa";

const ADDRESS_PREFIX_MAP = {
  mainnet: "kaspa",
  "testnet-10": "kaspatest",
};

const iUtxoEntrySchema = z.object({
  address: z.string().optional(),
  outpoint: z.object({
    transactionId: z.string(),
    index: z.number(),
  }),
  amount: z.string().min(1, "amount cannot be empty"),
  scriptPublicKey: z.object({
    version: z.number(),
    script: z.string(),
  }),
  blockDaaScore: z.string(),
  isCoinbase: z.boolean(),
});

export const buildTransactionPayloadSchema = z.object({
  outputs: z
    .array(
      z.object({
        address: z.string().min(1, "address cannot be empty"),
        amount: z.string().min(1, "amount cannot be empty"),
      }),
    )
    .min(1, "outputs cannot be empty"),
  priorityFee: z.string().default("0"),
  payload: z
    .string()
    .refine(
      (v) => /^[0-9a-fA-F]*$/.test(v) && v.length % 2 === 0,
      "payload must be a valid hex string (even length, 0-9 a-f only)",
    )
    .optional(),
  inputs: z.array(iUtxoEntrySchema).optional(),
});

export type BuildTransactionPayload = z.infer<
  typeof buildTransactionPayloadSchema
>;

/** buildTransaction handler - builds a transaction from the current account's UTXOs */
export const buildTransactionHandler: Handler = async (
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

  const result = buildTransactionPayloadSchema.safeParse(message.payload);
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
  const settings = await ApiUtils.getSettings();
  const networkId = settings.networkId;
  const addressPrefix = ADDRESS_PREFIX_MAP[networkId];

  // Validate all output addresses
  for (const output of parsed.outputs) {
    if (!Address.validate(output.address)) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          `Invalid address: ${output.address}`,
        ),
      );
      return;
    }
    const parsedAddress = new Address(output.address);
    if (parsedAddress.prefix !== addressPrefix) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          `Address network mismatch: ${output.address}`,
        ),
      );
      return;
    }
  }

  const account = await ApiUtils.getCurrentAccount();
  if (!account?.address) {
    sendResponse(
      ApiUtils.createApiResponse(message.id, null, "No account found"),
    );
    return;
  }

  const rpcClient = await ApiUtils.getKaspaRpcClient();
  try {
    await rpcClient.connect();

    let entries: any[];
    if (parsed.inputs && parsed.inputs.length > 0) {
      entries = parsed.inputs.map((input) => ({
        address: input.address ? new Address(input.address) : undefined,
        outpoint: input.outpoint,
        amount: BigInt(input.amount),
        scriptPublicKey: input.scriptPublicKey,
        blockDaaScore: BigInt(input.blockDaaScore),
        isCoinbase: input.isCoinbase,
      }));
    } else {
      const result = await rpcClient.getUtxosByAddresses([account.address]);
      entries = result.entries;
    }

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

    // Validate payload is a valid hex string if provided
    const payloadHex = parsed.payload;

    const { transactions: pendingTxs } = await createTransactions({
      entries,
      outputs: parsed.outputs.map((o) => ({
        address: o.address,
        amount: BigInt(o.amount),
      })),
      priorityFee: BigInt(parsed.priorityFee),
      changeAddress: account.address,
      payload: payloadHex,
      networkId,
    });

    if (pendingTxs.length === 0) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "Failed to build transaction",
        ),
      );
      return;
    }

    // Serialize all pending transactions (may be multiple for UTXO compounding)
    const transactions = pendingTxs.map((tx) => ({
      txJson: tx.serializeToSafeJSON(),
      id: tx.id,
      feeAmount: tx.feeAmount.toString(),
      changeAmount: tx.changeAmount.toString(),
    }));

    sendResponse(
      ApiUtils.createApiResponse(message.id, {
        networkId,
        transactions,
      }),
    );
  } catch (error) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        `Failed to build transaction: ${error}`,
      ),
    );
  } finally {
    await rpcClient.disconnect();
  }
};
