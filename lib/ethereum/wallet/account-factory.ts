import { EthereumRecoveryPhraseAccount } from "./account/recovery-phrase-account";
import { EthereumPrivateKeyAccount } from "./account/private-key-account";
import { Mnemonic } from "@/wasm/core/kaspa";

export class AccountFactory {
  static createFromMnemonic(
    mnemonic: string,
    accountIndex: number,
  ): EthereumRecoveryPhraseAccount {
    const seed = new Mnemonic(mnemonic).toSeed();
    return new EthereumRecoveryPhraseAccount(seed, accountIndex);
  }

  static createFromPrivateKey(privateKey: string): EthereumPrivateKeyAccount {
    return new EthereumPrivateKeyAccount(privateKey);
  }
}
