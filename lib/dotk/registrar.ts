import { Registrar } from "@dotk/sdk-tx";
import type { RpcClient } from "@/wasm/core/kaspa";
import type { IWallet } from "@/lib/wallet/wallet-interface";
import { getDotk } from "@/lib/dotk/client";
import { makeTxNode } from "@/lib/dotk/node";
import { makeDotkSigner } from "@/lib/dotk/signer";

// One Registrar per operation: its spent/held/doubtful sets are in-memory and a
// timed-out commit poisons the gap for that instance.
export function makeRegistrar({
  networkId,
  rpcClient,
  walletSigner,
  address,
}: {
  networkId: string;
  rpcClient: RpcClient;
  walletSigner: Pick<IWallet, "signTx">;
  address: string;
}) {
  const dotk = getDotk(networkId);
  return new Registrar({
    dotk,
    node: makeTxNode(() => rpcClient, networkId),
    signer: makeDotkSigner(walletSigner),
    account: { address, ...dotk.ownerOf(address) },
  });
}
