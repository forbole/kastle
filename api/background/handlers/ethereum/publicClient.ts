import { ApiRequestWithHost } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import { createPublicClient, http } from "viem";
import { RpcRequestSchema, RPC_ERRORS } from "@/api/message";
import { handleViemError } from "@/lib/errors";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";

export const PUBLIC_CLIENT_METHODS = new Set([
  "eth_blockNumber",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getUncleCountByBlockHash",
  "eth_getUncleCountByBlockNumber",

  "eth_getBalance",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",

  "eth_sendRawTransaction",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionReceipt",

  "eth_gasPrice",
  "eth_feeHistory",

  "eth_getLogs",
  "eth_newFilter",
  "eth_newBlockFilter",
  "eth_newPendingTransactionFilter",
  "eth_uninstallFilter",
  "eth_getFilterChanges",
  "eth_getFilterLogs",

  "eth_syncing",
]);

export const publicClientHandler = async (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response?: any) => void,
) => {
  const { payload } = message;
  const request = RpcRequestSchema.parse(payload);

  const settings = await ApiUtils.getSettings();
  const evmChainId = settings.evmL2ChainId?.[settings.networkId];

  const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find((c) => c.id === evmChainId);
  if (!chain) {
    sendResponse(
      ApiUtils.createApiResponse(
        message.id,
        null,
        RPC_ERRORS.UNSUPPORTED_CHAIN,
      ),
    );
    return;
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  try {
    const response = await publicClient.request({
      method: request.method as Parameters<
        typeof publicClient.request
      >[0]["method"],
      params: request.params as Parameters<
        typeof publicClient.request
      >[0]["params"],
    });

    sendResponse(ApiUtils.createApiResponse(message.id, response));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        "Invalid parameters were provided to the RPC method.",
      )
    ) {
      sendResponse(
        ApiUtils.createApiResponse(message.id, null, RPC_ERRORS.INVALID_PARAMS),
      );
    } else {
      sendResponse(
        ApiUtils.createApiResponse(message.id, null, handleViemError(error)),
      );
    }
  }
};
