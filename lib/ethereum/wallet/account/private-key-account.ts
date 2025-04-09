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
    const hexMessage = `0x${Buffer.from(message, "utf-8").toString("hex")}`;
    return this.account.signMessage({ message: hexMessage });
  }

  async getAddress() {
    return this.account.address;
  }
}
