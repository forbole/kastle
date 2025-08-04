import { privateKeyToAccount, PrivateKeyAccount } from "viem/accounts";
import { TransactionSerializable, SignTypedDataParameters, Hex } from "viem";
import { IWallet } from "../wallet-interface.ts";

export class EthereumPrivateKeyAccount implements IWallet {
  private readonly account: PrivateKeyAccount;

  constructor(privateKey: string) {
    if (!privateKey.startsWith("0x")) {
      privateKey = "0x" + privateKey;
    }
    this.account = privateKeyToAccount(privateKey as Hex);
  }

  async signTransaction(transaction: TransactionSerializable) {
    return this.account.signTransaction(transaction);
  }

  async signTypedData(typedData: SignTypedDataParameters) {
    return this.account.signTypedData(typedData);
  }

  async signMessage(message: string) {
    return this.account.signMessage({ message });
  }

  async getPublicKey() {
    return this.account.publicKey;
  }
}
