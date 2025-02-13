import { Opcodes, PublicKey, ScriptBuilder } from "@/wasm/core/kaspa";

export enum Fee {
  Deploy = 1000,
  Mint = 1,
  Transfer = 0.001,
  Base = 0.001,
}

export const OP_FEES = {
  deploy: Fee.Deploy,
  mint: Fee.Mint,
  transfer: Fee.Transfer,
};
export type OpFeesKey = keyof typeof OP_FEES;

export enum Amount {
  ScriptUtxoAmount = "0.3",
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

export const applyDecimal = (decimalPlaces: string = "8") => {
  const decimalCoefficient = Math.pow(10, parseInt(decimalPlaces, 10));

  return {
    toFloat: (amount: number) => amount / decimalCoefficient,
    toInteger: (amount: number) => amount * decimalCoefficient,
  };
};
