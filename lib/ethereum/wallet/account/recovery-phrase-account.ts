import { XPrv } from "@/wasm/core/kaspa";
import { privateKeyToAccount } from "viem/accounts";

export class EthereumRecoveryPhraseAccount {
  constructor(
    private readonly seed: string,
    private readonly accountIndex: number,
  ) {}

  async signMessage(message: string) {
    const privateKey = this.getPrivateKey();
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const signature = await account.signMessage({ message });
    return signature;
  }

  private getPrivateKey() {
    const xprv = new XPrv(this.seed);
    const privateKey = xprv
      .derivePath(`m/44'/60'/${this.accountIndex}'/0/0`)
      .toPrivateKey();
    return "0x" + privateKey.toString();
  }
}
