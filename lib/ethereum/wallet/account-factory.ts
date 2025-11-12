import { EthereumPrivateKeyAccount } from "./account/private-key-account";
import { Mnemonic } from "@/wasm/core/kaspa";
import { XPrv } from "@/wasm/core/kaspa";

export class LegacyAccountFactory {
  createFromMnemonic(
    mnemonic: string,
    accountIndex: number,
    isKastleLegacy = false,
  ): EthereumPrivateKeyAccount {
    const seed = new Mnemonic(mnemonic).toSeed();
    const xprv = new XPrv(seed);
    const path = isKastleLegacy
      ? `m/44'/111111'/${accountIndex}'/0/0`
      : `m/44'/111111'/0'/0/${accountIndex}`;

    const privateKey = xprv.derivePath(path).toPrivateKey();

    return new EthereumPrivateKeyAccount(privateKey.toString());
  }

  createFromPrivateKey(privateKey: string): EthereumPrivateKeyAccount {
    return new EthereumPrivateKeyAccount(privateKey);
  }
}

export class AccountFactory extends LegacyAccountFactory {
  createFromMnemonic(
    mnemonic: string,
    accountIndex: number,
    isKastleLegacy = false,
  ): EthereumPrivateKeyAccount {
    const seed = new Mnemonic(mnemonic).toSeed();
    const xprv = new XPrv(seed);
    const path = isKastleLegacy
      ? `m/44'/60'/${accountIndex}'/0/0`
      : `m/44'/60'/0'/0/${accountIndex}`;

    const privateKey = xprv.derivePath(path).toPrivateKey();
    return new EthereumPrivateKeyAccount(privateKey.toString());
  }
}
