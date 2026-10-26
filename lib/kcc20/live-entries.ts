import { covenantSelect } from "@kronsdk/kron-sdk";
import { RpcClient } from "@/wasm/core/kaspa";

/** The node's UTXOs at `addresses`, in the shape the SDK's covenantSelect helpers read. */
export async function liveEntries(rpc: RpcClient, addresses: string[]) {
  const { entries } = await rpc.getUtxosByAddresses(addresses);
  return entries.map((e) => ({
    outpoint: {
      transactionId: e.outpoint.transactionId,
      index: e.outpoint.index,
    },
    covenantId: covenantSelect.normalizedCovenantId(e.entry.covenantId),
    address: e.address?.toString(),
    amount: BigInt(e.entry.amount),
  }));
}
