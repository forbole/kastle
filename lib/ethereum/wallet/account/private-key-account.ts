import { XPrv } from "@/wasm/core/kaspa";
import { privateKeyToAccount, PrivateKeyAccount } from "viem/accounts";

export class EthereumPrivateKeyAccount {
  private readonly account: PrivateKeyAccount;

  constructor(privateKey: string) {
    if (!privateKey.startsWith("0x")) {
      privateKey = "0x" + privateKey;
    }
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
  }

  async signMessage(message: string) {
    return this.account.signMessage({ message });
  }
}
