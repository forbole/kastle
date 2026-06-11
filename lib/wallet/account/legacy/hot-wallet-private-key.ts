/**
 * Mainnet private-key hot wallet.
 *
 * Accepts/returns new-WASM Transaction, bridges internally through legacy WASM
 * for signing (compatible with Kaspa node 1.2.0).
 */
import {
  createInputSignature,
  Keypair,
  PrivateKey,
  ScriptBuilder,
  signTransaction,
  Transaction as TransactionLegacy,
  signMessage,
} from "@/wasm/legacy/kaspa";
import { Transaction, PublicKey } from "@/wasm/core/kaspa";
import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import {
  toSignType,
  stripTransactionJSON,
  patchTransactionJSON,
} from "@/lib/kaspa.ts";

function toLegacy(tx: Transaction): TransactionLegacy {
  return TransactionLegacy.deserializeFromSafeJSON(
    stripTransactionJSON(tx.serializeToSafeJSON()),
  );
}

function fromLegacy(legacyTx: TransactionLegacy): Transaction {
  // Legacy WASM serializes without computeBudget; patch before new WASM parses.
  return Transaction.deserializeFromSafeJSON(
    patchTransactionJSON(legacyTx.serializeToSafeJSON()),
  );
}

export class LegacyWasmHotWalletPrivateKey implements IWallet {
  keypair: Keypair;

  constructor(private privateKey: PrivateKey) {
    this.keypair = privateKey.toKeypair();
  }

  getPrivateKeyString() {
    return this.keypair.privateKey;
  }

  // Public key hex is identical regardless of WASM version — safe to cast.
  getPublicKey(): PublicKey {
    return this.privateKey.toPublicKey() as unknown as PublicKey;
  }

  getPublicKeys(): string[] {
    return [this.keypair.publicKey];
  }

  async signTx(
    tx: Transaction,
    scripts?: ScriptOption[],
  ): Promise<Transaction> {
    const legacyTx = toLegacy(tx);
    if (scripts) {
      await Promise.all(
        scripts.map((script) => this.signTxInputWithScript(legacyTx, script)),
      );
    }
    const isFullySigned = legacyTx.inputs.every(
      (input) => !!input.signatureScript,
    );
    if (isFullySigned) {
      return fromLegacy(legacyTx);
    }
    const signed = signTransaction(
      legacyTx,
      [this.getPrivateKeyString()],
      false,
    );
    return fromLegacy(signed);
  }

  async signTxInputWithScript(tx: TransactionLegacy, script: ScriptOption) {
    if (tx.inputs.length <= script.inputIndex) {
      throw new Error("Input index out of range");
    }
    if (tx.inputs[script.inputIndex].signatureScript) {
      throw new Error("Input already signed");
    }

    const signature = createInputSignature(
      tx,
      script.inputIndex,
      new PrivateKey(this.getPrivateKeyString()),
      // SighashType enum values are identical across WASM versions
      toSignType(script.signType ?? "All") as any,
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
    return signMessage({ message, privateKey: this.getPrivateKeyString() });
  }
}
