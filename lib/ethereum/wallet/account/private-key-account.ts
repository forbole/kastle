import {
  privateKeyToAccount,
  PrivateKeyAccount,
  SignTypedDataParameters,
} from "viem/accounts";
import { TransactionSerializable } from "viem";

export class EthereumPrivateKeyAccount {
  private readonly account: PrivateKeyAccount;

  constructor(privateKey: string) {
    if (!privateKey.startsWith("0x")) {
      privateKey = "0x" + privateKey;
    }
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
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

  async getAddress() {
    return this.account.address;
  }

  async getPublicKey() {
    return this.account.publicKey;
  }
}
