import { TransactionSerializable } from "viem";

export interface IWallet {
  signMessage(message: string): Promise<string>;

  signTransaction(transaction: TransactionSerializable): Promise<string>;

  getAddress(): Promise<string>;
}
