import { PublicKey, Transaction, XPrv, signMessage } from "@/wasm/core/kaspa";

import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { signTxWithScriptOptions } from "@/lib/wallet/sign-script.ts";

export class LegacyHotWalletAccount implements IWallet {
  private readonly MAX_DERIVATION_INDEXES = 50;

  constructor(
    protected readonly seed: string,
    protected readonly accountIndex: number,
  ) {}

  public getPrivateKeyString() {
    const privateKey = this.getPrivateKey();
    return privateKey.toKeypair().privateKey;
  }

  public getPublicKeys() {
    const xprv = new XPrv(this.seed);

    const publicKeys: string[] = [];

    for (let index = 0; index < this.MAX_DERIVATION_INDEXES; index++) {
      const privateKey = xprv
        .derivePath(`m/44'/111111'/${this.accountIndex}'/0/${index}`)
        .toPrivateKey();

      publicKeys.push(privateKey.toPublicKey().toString());
    }

    return publicKeys;
  }

  // NOTE: This method does not support signing with multiple keys
  async signTx(tx: Transaction, scripts?: ScriptOption[]) {
    return signTxWithScriptOptions(tx, scripts, this.getPrivateKeyString());
  }

  getPublicKey(): PublicKey {
    return this.getPrivateKey().toPublicKey();
  }

  signMessage(message: string): string {
    return signMessage({ message, privateKey: this.getPrivateKeyString() });
  }

  protected getPrivateKey() {
    const xprv = new XPrv(this.seed);
    return xprv
      .derivePath(`m/44'/111111'/${this.accountIndex}'/0/0`)
      .toPrivateKey();
  }

  protected getPrivateKeys(indexes: number[]) {
    const xprv = new XPrv(this.seed);
    const privateKeys = [];

    for (const index of indexes) {
      const address = xprv
        .derivePath(`m/44'/111111'/${this.accountIndex}'/0/${index}`)
        .toPrivateKey();

      privateKeys.push(address.toKeypair().privateKey);
    }

    return privateKeys;
  }
}

export class HotWalletAccount extends LegacyHotWalletAccount {
  constructor(seed: string, accountIndex: number) {
    super(seed, accountIndex);
  }

  override getPublicKeys() {
    const xprv = new XPrv(this.seed);
    const privateKey = xprv
      .derivePath(`m/44'/111111'/0'/0/${this.accountIndex}`)
      .toPrivateKey();

    return [privateKey.toPublicKey().toString()];
  }

  override getPrivateKey() {
    const xprv = new XPrv(this.seed);
    return xprv
      .derivePath(`m/44'/111111'/0'/0/${this.accountIndex}`)
      .toPrivateKey();
  }

  override getPrivateKeys(indexes: number[]) {
    return [this.getPrivateKey().toKeypair().privateKey];
  }
}
