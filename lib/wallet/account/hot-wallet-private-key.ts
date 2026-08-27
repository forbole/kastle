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

  // Takes ownership of the PrivateKey: it is retained for the lifetime of this
  // instance and borrowed by every signing call, so the caller must not free it.
  // Every call site constructs one inline for exactly this reason.
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
