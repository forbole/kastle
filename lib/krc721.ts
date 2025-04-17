import { IWallet, PaymentOutput } from "@/lib/wallet/wallet-interface.ts";
import { Opcodes, ScriptBuilder } from "@/wasm/core/kaspa";

export enum Fee {
  Base = 0.001,
}

export const transfer = (
  wallet: IWallet,
  payload: { tick: string; tokenId: string; to: string },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = {
    p: "krc-721",
    op: "transfer",
    ...payload,
  };
  const script = new ScriptBuilder()
    .addData(wallet.getPublicKey().toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(Buffer.from("kspr"))
    .addI64(0n)
    .addData(Buffer.from(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);

  return wallet.performCommitReveal(script, Fee.Base.toString()!, extraOutputs);
};
