import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import {
  PublicKey,
  ScriptPublicKey,
  Transaction,
  TransactionInput,
  TransactionOutput,
} from "@/wasm/core/kaspa";
import Transport from "@ledgerhq/hw-transport";

import KaspaApp, {
  Transaction as LedgerTransaction,
  TransactionInput as LedgerTransactionInput,
  TransactionOutput as LedgerTransactionOutput,
} from "hw-app-kaspa";

const LEDGER_ACCOUNT_INDEX_OFFSET = 0x80000000;

/**
 * The three numbers the Ledger app turns into a BIP-32 path.
 *
 * app-kaspa derives, for every input it signs:
 *
 *   44' / 111111' / <account>' / <addressType> / <addressIndex>
 *
 * (src/crypto.c: `bip32_path[2] = transaction.account`,
 * `bip32_path[3] = txin->address_type`, `bip32_path[4] = txin->address_index`),
 * and validates the change output against the same account using
 * `change_address_type` / `change_address_index`
 * (src/transaction/tx_validate.c). `account` is sent already hardened, the
 * other two are not hardened.
 *
 * These must describe exactly the key that `this.path` derives, because that
 * is the key `getPublicKey` shows the user as their address. If they diverge,
 * the device signs with a key the funds are not locked to and the network
 * rejects the transaction.
 */
type LedgerDerivation = {
  /** Unhardened account-level index; hardened at the hw-app-kaspa boundary. */
  account: number;
  addressType: 0 | 1;
  addressIndex: number;
};

/**
 * hw-app-kaspa marshals sompi as a JS `number` — `TransactionInput.value` and
 * `TransactionOutput.value` are typed `number` and serialized via
 * `toBigEndianHex`, which calls `.toString(16)` on it. Anything above
 * `Number.MAX_SAFE_INTEGER` would be silently rounded on the way to the device,
 * so refuse it instead.
 */
const MAX_LEDGER_SOMPI = BigInt(Number.MAX_SAFE_INTEGER);

function toLedgerSompi(value: bigint | undefined, what: string): number {
  if (value === undefined || value === null) {
    throw new Error(`Cannot sign on Ledger: ${what} has no amount.`);
  }
  if (value < 0n || value > MAX_LEDGER_SOMPI) {
    throw new Error(
      `Cannot sign on Ledger: ${what} is ${value} sompi, which is outside the range the Ledger app can be given exactly (0 to ${MAX_LEDGER_SOMPI} sompi).`,
    );
  }
  return Number(value);
}

export class LegacyLedgerAccount implements IWallet {
  private readonly app: KaspaApp;

  constructor(
    transport: Transport,
    protected readonly accountIndex: number,
  ) {
    this.app = new KaspaApp(transport);
  }

  /**
   * The single source of truth for this account's derivation. Both `this.path`
   * (what addresses are derived from) and the fields sent to the device read
   * this, so the two cannot silently drift apart.
   */
  protected getDerivationFields(): LedgerDerivation {
    return { account: this.accountIndex, addressType: 0, addressIndex: 0 };
  }

  protected get path(): string {
    const { account, addressType, addressIndex } = this.getDerivationFields();
    return `m/44'/111111'/${account}'/${addressType}/${addressIndex}`;
  }

  public getPrivateKeyString(): string {
    throw new Error("Ledger wallet does not support getPrivateKey");
  }

  async getPublicKey() {
    const response = await this.app.getPublicKey(this.path, false);
    // Index 0 is the length of the following full public key
    const keyLength: number = response.readUInt8(0);

    const publicKeyBuffer = response.subarray(1, keyLength + 1);
    return new PublicKey(publicKeyBuffer.toString("hex"));
  }

  public async getPublicKeys(): Promise<string[]> {
    const response = await this.app.getPublicKey(this.path, false);
    // Index 0 is the length of the following full public key
    const keyLength: number = response.readUInt8(0);

    const publicKeyBuffer = response.subarray(1, keyLength + 1);
    return [publicKeyBuffer.toString("hex")];
  }

  public async signTx(
    tx: Transaction,
    scripts?: ScriptOption[],
  ): Promise<Transaction> {
    if (scripts) {
      throw new Error("Method not implemented.");
    }
    const transaction = tx as Transaction;
    const { account, addressType, addressIndex } = this.getDerivationFields();

    // Kastle is single-address-per-account today, so every input is locked to
    // the same key as the account itself. Sending the derivation per input
    // rather than a hardcoded 0/0 keeps that an explicit consequence of
    // getDerivationFields() instead of a coincidence.
    const inputs = transaction.inputs.map((input, index) => {
      const utxo = input.utxo;
      if (!utxo) {
        throw new Error(
          `Cannot sign on Ledger: input ${index} is missing its UTXO entry, so its amount and outpoint are unknown.`,
        );
      }

      return new LedgerTransactionInput({
        value: toLedgerSompi(utxo.amount, `input ${index}`),
        prevTxId: utxo.outpoint.transactionId,
        outpointIndex: utxo.outpoint.index,
        addressType,
        addressIndex,
      });
    });

    const outputs = transaction.outputs.map(
      (output, index) =>
        new LedgerTransactionOutput({
          value: toLedgerSompi(output.value, `output ${index}`),
          scriptPublicKey:
            typeof output.scriptPublicKey === "string"
              ? output.scriptPublicKey
              : output.scriptPublicKey.script,
        }),
    );

    const ledgerTx = new LedgerTransaction({
      version: 0,
      inputs,
      outputs,
      changeAddressType: addressType,
      changeAddressIndex: addressIndex,
      account: account + LEDGER_ACCOUNT_INDEX_OFFSET,
    });

    await this.app.signTransaction(ledgerTx);

    return this.toRpcTransaction(ledgerTx);
  }

  async signMessage(message: string): Promise<string> {
    const { account, addressType, addressIndex } = this.getDerivationFields();

    return (
      await this.app.signMessage(
        message,
        addressType,
        addressIndex,
        account + LEDGER_ACCOUNT_INDEX_OFFSET,
      )
    ).signature;
  }

  private toRpcTransaction(signedTx: LedgerTransaction): Transaction {
    const inputs = signedTx.inputs.map((currInput: LedgerTransactionInput) => {
      return new TransactionInput({
        signatureScript: `41${currInput.signature}01`,
        previousOutpoint: {
          index: currInput.outpointIndex,
          transactionId: currInput.prevTxId,
        },
        sequence: BigInt(0),
        sigOpCount: 1,
      });
    });

    const outputs = signedTx.outputs.map(
      (currOutput: LedgerTransactionOutput) => {
        return new TransactionOutput(
          BigInt(currOutput.value),
          new ScriptPublicKey(0, currOutput.scriptPublicKey),
        );
      },
    );

    return new Transaction({
      inputs,
      outputs,
      gas: BigInt(0),
      lockTime: BigInt(0),
      subnetworkId: "0000000000000000000000000000000000000000",
      payload: "",
      version: 0,
    });
  }
}

export class LedgerAccount extends LegacyLedgerAccount {
  protected override getDerivationFields(): LedgerDerivation {
    return { account: 0, addressType: 0, addressIndex: this.accountIndex };
  }
}
