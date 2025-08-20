import {
  createInputSignature,
  Keypair,
  PrivateKey,
  PublicKey,
  ScriptBuilder,
  signTransaction,
  Transaction,
  signMessage,
} from "@/wasm/core/kaspa";

import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { toSignType } from "@/lib/kaspa.ts";

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
    if (scripts) {
      await Promise.all(
        scripts.map((script) => this.signTxInputWithScript(tx, script)),
      );
    }

    const isFullySigned = tx.inputs.every((input) => !!input.signatureScript);
    if (isFullySigned) {
      return tx;
    }

    return signTransaction(tx, [this.getPrivateKeyString()], false);
  }

  async signTxInputWithScript(tx: Transaction, script: ScriptOption) {
    // check if the input does exist
    if (tx.inputs.length <= script.inputIndex) {
      throw new Error("Input index out of range");
    }

    // check if the input is not already signed
    if (tx.inputs[script.inputIndex].signatureScript) {
      throw new Error("Input already signed");
    }

    const signature = createInputSignature(
      tx,
      script.inputIndex,
      new PrivateKey(this.getPrivateKeyString()),
      toSignType(script.signType ?? "All"),
    );

    if (script.scriptHex) {
      const scriptBuilder = ScriptBuilder.fromScript(script.scriptHex);
      tx.inputs[script.inputIndex].signatureScript =
        scriptBuilder.encodePayToScriptHashSignatureScript(signature);
    } else {
      tx.inputs[script.inputIndex].signatureScript = signature;
    }
  }

  signMessage(message: string): string {
    return signMessage({ message, privateKey: this.privateKey });
  }
}
