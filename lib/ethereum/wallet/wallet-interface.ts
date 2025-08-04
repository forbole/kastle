import { TransactionSerializable, SignTypedDataParameters, Hex } from "viem";

export interface IWallet {
  signMessage(message: string): Promise<Hex>;

  signTypedData(typedData: SignTypedDataParameters): Promise<Hex>;

  signTransaction(transaction: TransactionSerializable): Promise<Hex>;

  getPublicKey(): Promise<string>;
}

export interface IWalletWithGetAddress extends IWallet {
  getAddress(): Hex | Promise<Hex>;
}
