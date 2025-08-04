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

export class LegacyLedgerAccount implements IWallet {
  private readonly app: KaspaApp;
  protected path: string;

  constructor(
    transport: Transport,
    private readonly accountIndex: number,
  ) {
    this.app = new KaspaApp(transport);
    this.path = `m/44'/111111'/${accountIndex}'/0/0`;
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

    const inputs = tx.inputs.map(
      (input) =>
        new LedgerTransactionInput({
          value: Number(input.utxo?.amount),
          prevTxId: input.utxo?.outpoint.transactionId ?? "",
          outpointIndex: input.utxo?.outpoint.index ?? 0,
          addressType: 0,
          addressIndex: 0,
        }),
    );

    const outputs = tx.outputs.map(
      (output) =>
        new LedgerTransactionOutput({
          value: Number(output.value),
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
      changeAddressType: 0,
      changeAddressIndex: 0,
      account: this.accountIndex + LEDGER_ACCOUNT_INDEX_OFFSET,
    });

    await this.app.signTransaction(ledgerTx);

    return this.toRpcTransaction(ledgerTx);
  }

  async signMessage(message: string): Promise<string> {
    return (
      await this.app.signMessage(
        message,
        0,
        0,
        this.accountIndex + LEDGER_ACCOUNT_INDEX_OFFSET,
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
  constructor(transport: Transport, accountIndex: number) {
    super(transport, accountIndex);
    this.path = `m/44'/111111'/0'/0/${accountIndex}`;
  }
}
