import { EthereumPrivateKeyAccount } from "./account/private-key-account";
import { Mnemonic } from "@/wasm/core/kaspa";
import { XPrv } from "@/wasm/core/kaspa";

export class AccountFactory {
  static createFromMnemonic(
    mnemonic: string,
    accountIndex: number,
  ): EthereumPrivateKeyAccount {
    const seed = new Mnemonic(mnemonic).toSeed();
    const xprv = new XPrv(seed);
    const privateKey = xprv
      .derivePath(`m/44'/111111'/${accountIndex}'/0/0`)
      .toPrivateKey();

    return new EthereumPrivateKeyAccount(privateKey.toString());
  }

  static createFromPrivateKey(privateKey: string): EthereumPrivateKeyAccount {
    return new EthereumPrivateKeyAccount(privateKey);
  }
}
