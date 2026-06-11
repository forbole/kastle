/**
 * Mainnet hot wallet accounts.
 *
 * Accepts/returns new-WASM Transaction (same interface as all other accounts),
 * but bridges internally through legacy WASM for signing so that the produced
 * transaction is compatible with Kaspa node 1.2.0 (no extra consensus fields).
 *
 * Bridge: new Transaction → serializeToSafeJSON → stripTransactionJSON
 *       → legacy deserialize → sign with legacy WASM
 *       → legacy serializeToSafeJSON → new Transaction
 */
import {
  createInputSignature,
  PrivateKey,
  ScriptBuilder,
  signTransaction,
  Transaction as TransactionLegacy,
  XPrv,
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

export class LegacyWasmLegacyHotWalletAccount implements IWallet {
  private readonly MAX_DERIVATION_INDEXES = 50;

  constructor(
    protected readonly seed: string,
    protected readonly accountIndex: number,
  ) {}

  // Public key hex is identical regardless of WASM version — safe to cast.
  getPublicKey(): PublicKey {
    return this.getPrivateKey().toPublicKey() as unknown as PublicKey;
  }

  getPublicKeys(): string[] {
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

  getPrivateKeyString() {
    return this.getPrivateKey().toKeypair().privateKey;
  }

  protected getPrivateKey() {
    const xprv = new XPrv(this.seed);
    return xprv
      .derivePath(`m/44'/111111'/${this.accountIndex}'/0/0`)
      .toPrivateKey();
  }
}

export class LegacyWasmHotWalletAccount extends LegacyWasmLegacyHotWalletAccount {
  constructor(seed: string, accountIndex: number) {
    super(seed, accountIndex);
  }

  override getPublicKeys(): string[] {
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
}
