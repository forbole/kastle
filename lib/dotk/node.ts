import { txNodeOverWasm, toSafeJson, type TxNode } from "@dotk/sdk-tx";
import { Transaction, type RpcClient } from "@/wasm/core/kaspa";

// The sdk-tx adapter already covers every TxNode call over the wasm client:
// utxosOf (getUtxosByAddresses, with covenantId / scriptVersion /
// blockDaaScore), feerate (getFeeEstimate normalBuckets[0]) and submit
// (submitTransaction). Passing `network` makes the first call assert
// getServerInfo().networkId === network. The getter form survives Kastle's
// reconnecting client.
export const makeTxNode = (
  getRpcClient: () => RpcClient,
  networkId: string,
): TxNode => {
  const node = txNodeOverWasm(getRpcClient, networkId);
  return {
    ...node,
    // The sdk-tx wasm adapter submits `JSON.parse(toSafeJson(tx))`, whose
    // string fields (lockTime as a string) the wasm `submitTransaction`
    // rejects with "property 'lockTime' is not a number". Round-trip through a
    // wasm `Transaction` so every field is numeric before it goes on the wire.
    async submit(tx, options) {
      const wasmTx = Transaction.deserializeFromSafeJSON(toSafeJson(tx));
      const answer = await getRpcClient().submitTransaction({
        transaction: wasmTx,
        allowOrphan: false,
      });
      if (!answer?.transactionId) {
        throw new Error("the node accepted the transaction without naming it");
      }
      return answer.transactionId;
    },
  };
};
