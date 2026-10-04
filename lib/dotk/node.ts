import { txNodeOverWasm, type TxNode } from "@dotk/sdk-tx";
import type { RpcClient } from "@/wasm/core/kaspa";

// The sdk-tx adapter already covers every TxNode call over the wasm client:
// utxosOf (getUtxosByAddresses, with covenantId / scriptVersion /
// blockDaaScore), feerate (getFeeEstimate normalBuckets[0]) and submit
// (submitTransaction). Passing `network` makes the first call assert
// getServerInfo().networkId === network. The getter form survives Kastle's
// reconnecting client.
export const makeTxNode = (
  getRpcClient: () => RpcClient,
  networkId: string,
): TxNode => txNodeOverWasm(getRpcClient, networkId);
