import {
  IUtxoEntry,
  Address,
  ITransactionOutpoint,
  IScriptPublicKey,
  kaspaToSompi,
  SighashType,
  Transaction,
} from "@/wasm/core/kaspa";

export type PaymentOutput = {
  address: string;
  amount: string; // KAS
};

export type Entry = {
  amount: string; // KAS
  address: string;
  outpoint: ITransactionOutpoint;
  blockDaaScore: string; // BigInt
  scriptPublicKey: IScriptPublicKey;
};

export function toKaspaEntry(entry: Entry): IUtxoEntry {
  return {
    amount: kaspaToSompi(entry.amount) ?? 0n,
    address: entry.address ? new Address(entry.address) : undefined,
    outpoint: entry.outpoint,
    blockDaaScore: BigInt(entry.blockDaaScore),
    scriptPublicKey: entry.scriptPublicKey,
    isCoinbase: false,
  };
}

export type TransactionOptions = {
  priorityEntries?: Entry[];
  entries?: Entry[];
  priorityFee?: string; // KAS
  payload?: Uint8Array;
  scripts?: ScriptOption[];
};

export type ScriptOption = {
  inputIndex: number;
  scriptHex: string;
  signType?: SignType;
};

export type SignType =
  | "All"
  | "None"
  | "Single"
  | "AllAnyOneCanPay"
  | "NoneAnyOneCanPay"
  | "SingleAnyOneCanPay";

export function toSignType(signType: SignType): SighashType {
  switch (signType) {
    case "All":
      return SighashType.All;
    case "None":
      return SighashType.None;
    case "Single":
      return SighashType.Single;
    case "AllAnyOneCanPay":
      return SighashType.AllAnyOneCanPay;
    case "NoneAnyOneCanPay":
      return SighashType.NoneAnyOneCanPay;
    case "SingleAnyOneCanPay":
      return SighashType.SingleAnyOneCanPay;
    default:
      throw new Error(`Invalid sign type: ${signType}`);
  }
}

export type TransactionEstimate = {
  totalFees: string; // KAS
  numberOfTransactions: number;
  numberOfUtxos: number;
  finalAmount?: string; // KAS
};

export interface IWallet {
  send(
    amount: bigint,
    receiverAddress: string,
    priorityFee?: bigint,
  ): Promise<string[]>;

  getPrivateKey(): string;

  getPublicKeys(): string[] | Promise<string[]>;

  getBalance(): Promise<bigint>;

  getAddress(): string | Promise<string>;

  signAndBroadcastTx(
    outputs: PaymentOutput[],
    options?: TransactionOptions,
  ): Promise<string>;

  signTx(tx: Transaction, scripts?: ScriptOption[]): Promise<Transaction>;
}
