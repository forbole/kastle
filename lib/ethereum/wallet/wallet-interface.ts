import { TransactionSerializable } from "viem";

export interface IWallet {
  signMessage(message: string): Promise<`0x${string}`>;

  signTransaction(transaction: TransactionSerializable): Promise<`0x${string}`>;

  getAddress(): Promise<`0x${string}`>;
}
