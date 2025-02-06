import { Opcodes, PublicKey, ScriptBuilder } from "@/wasm/core/kaspa";

export enum Fee {
  Deploy = 1000,
  Mint = 1,
  Base = 0.001,
}

export const createKRC20ScriptBuilder = (pubKey: string, data: any) => {
  const publicKey = new PublicKey(pubKey);

  return new ScriptBuilder()
    .addData(publicKey.toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(new TextEncoder().encode("kasplex")) // Instead of Buffer.from
    .addI64(0n)
    .addData(new TextEncoder().encode(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);
};
