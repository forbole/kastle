import {
  IScriptPublicKey,
  ITransactionOutpoint,
  PublicKey,
  ScriptBuilder,
  Transaction,
} from "@/wasm/core/kaspa";
import { SIGN_TYPE } from "@/lib/kaspa.ts";

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

export type TxSettingOptions = {
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

export type CommitRevealResult = {
  status: "committing" | "revealing" | "completed";
  commitTxId?: string;
  revealTxId?: string;
};

export type SignType = keyof typeof SIGN_TYPE;

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

  getPrivateKeyString(): string;

  getPublicKey(): PublicKey;

  getPublicKeys(): string[] | Promise<string[]>;

  getBalance(): Promise<bigint>;

  getAddress(): string | Promise<string>;

  signAndBroadcastTx(
    outputs: PaymentOutput[],
    options?: TxSettingOptions,
  ): Promise<string>;

  signTx(tx: Transaction, scripts?: ScriptOption[]): Promise<Transaction>;

  performCommitReveal(
    scriptBuilder: ScriptBuilder,
    revealPriorityFee: string, // KAS
    extraOutputs?: PaymentOutput[],
  ): AsyncGenerator<CommitRevealResult>;
}
