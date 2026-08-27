import {
  Keypair,
  PrivateKey,
  PublicKey,
  Transaction,
  signMessage,
} from "@/wasm/core/kaspa";

import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { signTxWithScriptOptions } from "@/lib/wallet/sign-script.ts";

export class HotWalletPrivateKey implements IWallet {
  keypair: Keypair;

  constructor(private privateKey: PrivateKey) {
    this.keypair = privateKey.toKeypair();
  }

  getPrivateKeyString() {
    return this.keypair.privateKey;
  }

  getPublicKey(): PublicKey {
    return this.privateKey.toPublicKey();
  }

  getPublicKeys() {
    return [this.keypair.publicKey];
  }

  // NOTE: This method does not support signing with multiple keys
  async signTx(tx: Transaction, scripts?: ScriptOption[]) {
    return signTxWithScriptOptions(tx, scripts, this.getPrivateKeyString());
  }

  signMessage(message: string): string {
    // signMessage borrows the PrivateKey — it does not null the pointer — and
    // this one is owned by the instance, so pass the object straight through
    // instead of materialising the key as a hex string.
    return signMessage({ message, privateKey: this.privateKey });
  }
}
