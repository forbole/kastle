import { IWallet, PaymentOutput } from "@/lib/wallet/wallet-interface.ts";
import { Opcodes, ScriptBuilder } from "@/wasm/core/kaspa";
import { CommitRevealHelper } from "./commit-reveal";
import { RpcClient } from "@/wasm/core/kaspa";

export enum Fee {
  Base = 0.001,
}

export const transfer = async (
  wallet: IWallet,
  rpcClient: RpcClient,
  networkId: string,
  payload: { p?: string; id: string; to: string },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = {
    op: "transfer",
    ...payload,
  };
  const script = new ScriptBuilder()
    .addData((await wallet.getPublicKey()).toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(Buffer.from("kns"))
    .addI64(0n)
    .addData(Buffer.from(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);

  return new CommitRevealHelper(wallet, rpcClient, networkId, script).perform(
    Fee.Base.toString(),
    extraOutputs,
  );
};
