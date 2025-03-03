import {
  Address,
  IPaymentOutput,
  IScriptPublicKey,
  ITransactionOutpoint,
  IUtxoEntry,
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

const SIGN_TYPE = {
  All: SighashType.All,
  None: SighashType.None,
  Single: SighashType.Single,
  AllAnyOneCanPay: SighashType.AllAnyOneCanPay,
  NoneAnyOneCanPay: SighashType.NoneAnyOneCanPay,
  SingleAnyOneCanPay: SighashType.SingleAnyOneCanPay,
} as const;

export type SignType = keyof typeof SIGN_TYPE;

export function toSignType(signType: SignType): SighashType {
  return SIGN_TYPE[signType];
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

  getPrivateKeyString(): string;

  getPublicKeys(): string[] | Promise<string[]>;

  getBalance(): Promise<bigint>;

  getAddress(): string | Promise<string>;

  signAndBroadcastTx(
    outputs: PaymentOutput[],
    options?: TxSettingOptions,
  ): Promise<string>;

  signTx(tx: Transaction, scripts?: ScriptOption[]): Promise<Transaction>;

  deploy(
    payload: {
      tick: string;
      max: string;
      lim: string;
      dec: string;
      pre: string;
    },
    extraOutputs: IPaymentOutput[] | undefined,
  ): AsyncGenerator<string, void, unknown>;

  mint(
    payload: { tick: string },
    extraOutputs: IPaymentOutput[] | undefined,
  ): AsyncGenerator<string, void, unknown>;

  transfer(payload: {
    tick: string;
    amt: string;
    to: string;
  }): AsyncGenerator<string, void, unknown>;
}
