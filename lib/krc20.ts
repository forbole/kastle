import { Opcodes, ScriptBuilder } from "@/wasm/core/kaspa";
import { IWallet, PaymentOutput } from "@/lib/wallet/wallet-interface.ts";

export type Operation = "deploy" | "mint" | "transfer";

export enum Fee {
  Deploy = 1000,
  Mint = 1,
  Base = 0.001,
}

export enum ForboleFee {
  Deploy = 20,
  Mint = 0.2,
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

export const applyDecimal = (decimalPlaces: string = "8") => {
  const decimalCoefficient = Math.pow(10, parseInt(decimalPlaces, 10));

  return {
    toFloat: (amount: number) => amount / decimalCoefficient,
    toInteger: (amount: number) => amount * decimalCoefficient,
  };
};

export const computeOperationFees = (op: Operation, times: number = 1) => {
  const krc20Fee = OP_FEES[op] * times;
  const kaspaFee = Fee.Base * times;
  const forboleFee = FORBOLE_FEES[op] * times;

  return {
    krc20Fee,
    kaspaFee,
    forboleFee,
    totalFees: krc20Fee + kaspaFee + forboleFee,
  };
};

export const deploy = (
  wallet: IWallet,
  payload: {
    tick: string;
    max: string;
    lim: string;
    dec: string;
    pre: string;
  },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = { p: "krc-20", op: "deploy", ...payload };
  const script = new ScriptBuilder()
    .addData(wallet.getPublicKey().toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(Buffer.from("kasplex"))
    .addI64(0n)
    .addData(Buffer.from(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);

  return wallet.performCommitReveal(
    script,
    Fee.Deploy.toString()!,
    extraOutputs,
  );
};

export const mint = (
  wallet: IWallet,
  payload: { tick: string },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = { p: "krc-20", op: "mint", ...payload };
  const script = new ScriptBuilder()
    .addData(wallet.getPublicKey().toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(Buffer.from("kasplex"))
    .addI64(0n)
    .addData(Buffer.from(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);

  return wallet.performCommitReveal(script, Fee.Mint.toString()!, extraOutputs);
};

export const transfer = (
  wallet: IWallet,
  payload: { tick: string; amt: string; to: string },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = { p: "krc-20", op: "transfer", ...payload };
  const script = new ScriptBuilder()
    .addData(wallet.getPublicKey().toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(Buffer.from("kasplex"))
    .addI64(0n)
    .addData(Buffer.from(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);

  return wallet.performCommitReveal(script, Fee.Base.toString()!, extraOutputs);
};
