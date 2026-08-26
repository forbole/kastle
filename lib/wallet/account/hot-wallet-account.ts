import { PublicKey, Transaction, XPrv, signMessage } from "@/wasm/core/kaspa";

import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { signTxWithScriptOptions } from "@/lib/wallet/sign-script.ts";
import { withOwned } from "@/lib/wallet/wasm-lifecycle.ts";

export class LegacyHotWalletAccount implements IWallet {
  private readonly MAX_DERIVATION_INDEXES = 50;

  constructor(
    protected readonly seed: string,
    protected readonly accountIndex: number,
  ) {}

  public getPrivateKeyString() {
    // getPrivateKey hands ownership to us, and `.privateKey` is a plain JS
    // string, so nothing WASM-side outlives this call
    return withOwned(
      (own) => own(own(this.getPrivateKey()).toKeypair()).privateKey,
    );
  }

  public getPublicKeys() {
    return withOwned((own) => {
      const xprv = own(new XPrv(this.seed));
      const publicKeys: string[] = [];

      for (let index = 0; index < this.MAX_DERIVATION_INDEXES; index++) {
        // free per iteration: one scope around the whole loop would hold 150
        // live WASM objects at peak
        publicKeys.push(
          withOwned((ownIndex) => {
            const derived = ownIndex(
              xprv.derivePath(`m/44'/111111'/${this.accountIndex}'/0/${index}`),
            );
            const privateKey = ownIndex(derived.toPrivateKey());

            return ownIndex(privateKey.toPublicKey()).toString();
          }),
        );
      }

      return publicKeys;
    });
  }

  // NOTE: This method does not support signing with multiple keys
  async signTx(tx: Transaction, scripts?: ScriptOption[]) {
    return signTxWithScriptOptions(tx, scripts, this.getPrivateKeyString());
  }

  getPublicKey(): PublicKey {
    // the PublicKey is returned, so it belongs to the caller — only the
    // PrivateKey is ours to free
    return withOwned((own) => own(this.getPrivateKey()).toPublicKey());
  }

  signMessage(message: string): string {
    return signMessage({ message, privateKey: this.getPrivateKeyString() });
  }

  protected getPrivateKey() {
    // the PrivateKey is returned to the caller, who owns it; the XPrv and the
    // intermediate derivation are ours
    return withOwned((own) =>
      own(
        own(new XPrv(this.seed)).derivePath(
          `m/44'/111111'/${this.accountIndex}'/0/0`,
        ),
      ).toPrivateKey(),
    );
  }

  protected getPrivateKeys(indexes: number[]) {
    return withOwned((own) => {
      const xprv = own(new XPrv(this.seed));

      return indexes.map((index) =>
        withOwned((ownIndex) => {
          const derived = ownIndex(
            xprv.derivePath(`m/44'/111111'/${this.accountIndex}'/0/${index}`),
          );

          return ownIndex(ownIndex(derived.toPrivateKey()).toKeypair())
            .privateKey;
        }),
      );
    });
  }
}

export class HotWalletAccount extends LegacyHotWalletAccount {
  constructor(seed: string, accountIndex: number) {
    super(seed, accountIndex);
  }

  override getPublicKeys() {
    return withOwned((own) => {
      const derived = own(
        own(new XPrv(this.seed)).derivePath(
          `m/44'/111111'/0'/0/${this.accountIndex}`,
        ),
      );
      const privateKey = own(derived.toPrivateKey());

      return [own(privateKey.toPublicKey()).toString()];
    });
  }

  override getPrivateKey() {
    // as above: the returned PrivateKey is the caller's
    return withOwned((own) =>
      own(
        own(new XPrv(this.seed)).derivePath(
          `m/44'/111111'/0'/0/${this.accountIndex}`,
        ),
      ).toPrivateKey(),
    );
  }

  override getPrivateKeys(indexes: number[]) {
    return withOwned((own) => [
      own(own(this.getPrivateKey()).toKeypair()).privateKey,
    ]);
  }
}
