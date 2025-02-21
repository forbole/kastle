import { Opcodes, PublicKey, ScriptBuilder } from "@/wasm/core/kaspa";

export type Operation = "deploy" | "mint" | "transfer";

export enum Fee {
  Deploy = 1000,
  Mint = 1,
  Base = 0.001,
}

export enum ForboleFee {
  Deploy = 20,
  Mint = 0.02,
  None = 0,
}

export const OP_FEES: Record<Operation, Fee> = {
  deploy: Fee.Deploy,
  mint: Fee.Mint,
  transfer: Fee.Base,
};

export const FORBOLE_FEES: Record<Operation, ForboleFee> = {
  deploy: ForboleFee.Deploy,
  mint: ForboleFee.Mint,
  transfer: ForboleFee.None,
};

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

export const computeOperationFees = (op: Operation) => {
  const krc20Fee = OP_FEES[op];
  const kaspaFee = Fee.Base;
  const forboleFee = FORBOLE_FEES[op];

  return {
    krc20Fee,
    kaspaFee,
    forboleFee,
    totalFees: krc20Fee + kaspaFee + forboleFee,
  };
};
