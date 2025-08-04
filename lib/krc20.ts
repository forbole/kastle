import {
  Opcodes,
  ScriptBuilder,
  PublicKey,
  RpcClient,
} from "@/wasm/core/kaspa";
import { IWallet, PaymentOutput } from "@/lib/wallet/wallet-interface.ts";
import { CommitRevealHelper } from "./commit-reveal";

export type Operation = "deploy" | "mint" | "transfer";

export enum Krc20Fee {
  Deploy = 1000,
  Mint = 1,
  Base = 0.001,
}

export enum ForboleFee {
  Deploy = 20,
  Mint = 0.2,
  None = 0,
}

export const OP_FEES: Record<Operation, Krc20Fee> = {
  deploy: Krc20Fee.Deploy,
  mint: Krc20Fee.Mint,
  transfer: Krc20Fee.Base,
};

export const FORBOLE_FEES: Record<Operation, ForboleFee> = {
  deploy: ForboleFee.Deploy,
  mint: ForboleFee.Mint,
  transfer: ForboleFee.None,
};

export const applyDecimal = (decimalPlaces: string = "8") => {
  const decimalCoefficient = Math.pow(10, parseInt(decimalPlaces, 10));

  return {
    toFloat: (amount: number) => amount / decimalCoefficient,
    toInteger: (amount: number) => amount * decimalCoefficient,
  };
};

export const computeOperationFees = (op: Operation, times: number = 1) => {
  const krc20Fee = OP_FEES[op] * times;
  const kaspaFee = Krc20Fee.Base * times;
  const forboleFee = FORBOLE_FEES[op] * times;

  return {
    krc20Fee,
    kaspaFee,
    forboleFee,
    totalFees: krc20Fee + kaspaFee + forboleFee,
  };
};

export const buildCommitRevealScript = (
  publicKey: PublicKey,
  namespace: string,
  data: unknown,
) => {
  const script = new ScriptBuilder()
    .addData(publicKey.toXOnlyPublicKey().toString())
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpFalse)
    .addOp(Opcodes.OpIf)
    .addData(Buffer.from(namespace))
    .addI64(0n)
    .addData(Buffer.from(JSON.stringify(data, null, 0)))
    .addOp(Opcodes.OpEndIf);

  return script;
};

export const deploy = async (
  wallet: IWallet,
  rpcClient: RpcClient,
  networkId: string,
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
  const script = buildCommitRevealScript(
    await wallet.getPublicKey(),
    "kasplex",
    data,
  );

  const commitRevealHelper = new CommitRevealHelper(
    wallet,
    rpcClient,
    networkId,
    script,
  );
  return commitRevealHelper.perform(Krc20Fee.Deploy.toString(), extraOutputs);
};

export const mint = async (
  wallet: IWallet,
  rpcClient: RpcClient,
  networkId: string,
  payload: { tick: string },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = { p: "krc-20", op: "mint", ...payload };
  const script = buildCommitRevealScript(
    await wallet.getPublicKey(),
    "kasplex",
    data,
  );
  const commitRevealHelper = new CommitRevealHelper(
    wallet,
    rpcClient,
    networkId,
    script,
  );
  return commitRevealHelper.perform(Krc20Fee.Mint.toString(), extraOutputs);
};

export const transfer = async (
  wallet: IWallet,
  rpcClient: RpcClient,
  networkId: string,
  payload: { tick: string; amt: string; to: string },
  extraOutputs: PaymentOutput[] = [],
) => {
  const data = { p: "krc-20", op: "transfer", ...payload };
  const script = buildCommitRevealScript(
    await wallet.getPublicKey(),
    "kasplex",
    data,
  );

  const commitRevealHelper = new CommitRevealHelper(
    wallet,
    rpcClient,
    networkId,
    script,
  );
  return commitRevealHelper.perform(Krc20Fee.Base.toString(), extraOutputs);
};
