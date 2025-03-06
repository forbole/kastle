import {
  Address,
  IPaymentOutput,
  IScriptPublicKey,
  ITransactionOutpoint,
  IUtxoEntry,
  kaspaToSompi,
  PublicKey,
  RpcClient,
  ScriptBuilder,
  SighashType,
  Transaction,
} from "@/wasm/core/kaspa";

export type PaymentOutput = {
  address: string;
  amount: string; // KAS
};

export function toKaspaPaymentOutput(output: PaymentOutput): IPaymentOutput {
  return {
    address: new Address(output.address),
    amount: kaspaToSompi(output.amount) ?? 0n,
  };
}

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

export type CommitRevealResult = {
  status: "committing" | "revealing" | "completed";
  commitTxId?: string;
  revealTxId?: string;
};

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

// Wait for the transaction to be added to the UTXO set of the address
export const waitTxForAddress = async (
  rpcClient: RpcClient,
  address: string,
  txId: string,
) => {
  try {
    await rpcClient.subscribeUtxosChanged([address]);

    await new Promise<void>((resolve, reject) => {
      const handleUtxosChanged = (event: any) => {
        const addedEntry: IUtxoEntry = event.data.added.find(
          (entry: IUtxoEntry) =>
            entry.address?.payload === new Address(address).payload,
        );

        const removedEntry: IUtxoEntry = event.data.removed.find(
          (entry: IUtxoEntry) =>
            entry.address?.payload === new Address(address).payload,
        );

        const isEventReceived =
          addedEntry?.outpoint.transactionId === txId ||
          removedEntry?.outpoint.transactionId === txId;

        if (isEventReceived) {
          rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
          resolve();
        }
      };

      rpcClient.addEventListener("utxos-changed", handleUtxosChanged);
      setTimeout(() => {
        rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
        reject(new Error("Timeout"));
      }, 120000); // 2 minutes
    });
  } finally {
    await rpcClient.unsubscribeUtxosChanged([address]);
  }
};
