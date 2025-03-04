import {
  Address,
  addressFromScriptPublicKey,
  createInputSignature,
  createTransactions,
  Generator,
  IGeneratorSettingsObject,
  IPaymentOutput,
  kaspaToSompi,
  Keypair,
  PendingTransaction,
  PrivateKey,
  PublicKey,
  RpcClient,
  ScriptBuilder,
  signTransaction,
  Transaction,
  UtxoEntryReference,
} from "@/wasm/core/kaspa";

import {
  IWallet,
  PaymentOutput,
  ScriptOption,
  toKaspaEntry,
  toSignType,
  TxSettingOptions,
} from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { Amount } from "@/lib/krc20.ts";

export class HotWalletPrivateKey implements IWallet {
  keypair: Keypair;

  constructor(
    private privateKey: PrivateKey,
    private readonly rpcClient: RpcClient,
    private readonly networkId: NetworkType,
  ) {
    this.keypair = privateKey.toKeypair();
  }

  async *performCommitReveal(
    scriptBuilder: ScriptBuilder,
    revealPriorityFee: IGeneratorSettingsObject["priorityFee"],
    extraOutputs: IPaymentOutput[] = [],
  ) {
    yield "commiting";

    const privateKey = this.privateKey;
    const publicKey = privateKey.toPublicKey();
    const address = publicKey.toAddress(this.networkId);

    let eventReceived = false;
    let addedEventTxId: any;
    let submittedTxId: any;

    const handleUtxosChanged = async (event: any) => {
      const removedEntry = event.data.removed.find(
        (entry: any) => entry.address.payload === address.payload,
      );
      const addedEntry = event.data.added.find(
        (entry: any) => entry.address.payload === address.payload,
      );

      if (removedEntry) {
        addedEventTxId = addedEntry.outpoint.transactionId;
        if (addedEventTxId == submittedTxId) {
          eventReceived = true;
        }
      }
    };

    await this.rpcClient.subscribeUtxosChanged([address.toString()]);
    this.rpcClient.addEventListener("utxos-changed", handleUtxosChanged);

    const P2SHAddress = addressFromScriptPublicKey(
      scriptBuilder.createPayToScriptHashScript(),
      this.networkId,
    );

    if (!P2SHAddress) {
      throw new Error("Invalid P2SH address");
    }

    const { entries } = await this.rpcClient.getUtxosByAddresses({
      addresses: [address.toString()],
    });
    const { transactions } = await createTransactions({
      priorityEntries: [],
      entries,
      outputs: [
        {
          address: P2SHAddress.toString(),
          amount: kaspaToSompi(Amount.ScriptUtxoAmount)!,
        },
      ],
      priorityFee: kaspaToSompi(Amount.ScriptUtxoAmount),
      changeAddress: address.toString(),
      networkId: this.networkId,
    });

    for (const transaction of transactions) {
      console.log(`Commit TX ID: ${transaction.id}`);
      transaction.sign([privateKey]);
      const hash = await transaction.submit(this.rpcClient);
      submittedTxId = hash;
    }

    // Wait for the maturity event
    const commitTimeout = setTimeout(() => {
      if (!eventReceived) {
        throw new Error("Commit transaction did not mature within 2 minutes");
      }
    }, 120000);

    while (!eventReceived) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // wait and check every 500ms
    }

    clearTimeout(commitTimeout);
    yield "revealing";

    // Continue with reveal transaction after maturity event
    eventReceived = false;
    const { entries: newEntries } = await this.rpcClient.getUtxosByAddresses({
      addresses: [address.toString()],
    });

    const revealUTXOs = await this.rpcClient.getUtxosByAddresses({
      addresses: [P2SHAddress.toString()],
    });

    const { transactions: revealTransactions } = await createTransactions({
      priorityEntries: [revealUTXOs.entries[0]],
      entries: newEntries,
      outputs: extraOutputs,
      changeAddress: address.toString(),
      priorityFee: revealPriorityFee,
      networkId: this.networkId,
    });
    let revealHash: any;

    for (const transaction of revealTransactions) {
      console.log(`Reveal TX ID: ${transaction.id}`);
      transaction.sign([privateKey], false);
      const ourOutput = transaction.transaction.inputs.findIndex(
        (input) => input.signatureScript === "",
      );

      if (ourOutput !== -1) {
        const signature = transaction.createInputSignature(
          ourOutput,
          privateKey,
        );
        transaction.fillInput(
          ourOutput,
          scriptBuilder.encodePayToScriptHashSignatureScript(signature),
        );
      }
      revealHash = await transaction.submit(this.rpcClient);
      submittedTxId = revealHash;
    }

    const revealTimeout = setTimeout(() => {
      if (!eventReceived) {
        throw new Error("Reveal transaction did not mature within 2 minutes");
      }
    }, 120000);

    while (!eventReceived) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // wait and check every 500ms
    }

    this.rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
    clearTimeout(revealTimeout);
    eventReceived = false;
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

  async getBalance(): Promise<bigint> {
    const address = this.getAddress();
    const { entries } = await this.rpcClient.getBalancesByAddresses([address]);

    return entries.reduce((acc, curr) => acc + curr.balance, 0n);
  }

  async send(
    amount: bigint,
    receiverAddress: string,
    priorityFee?: bigint,
  ): Promise<string[]> {
    if (!Address.validate(receiverAddress)) {
      throw new Error("Invalid receiver address " + receiverAddress);
    }

    const txGenerator = new Generator({
      entries: await this.getUtxos(),
      outputs: [
        {
          address: receiverAddress,
          amount,
        },
      ],
      priorityFee,
      changeAddress: this.getAddress(),
      networkId: this.networkId,
    });

    const txIds = [];
    let pending;
    while ((pending = await txGenerator.next())) {
      await pending.sign([this.keypair.privateKey]);
      const txid = await pending.submit(this.rpcClient);
      txIds.push(txid);
    }
    return txIds;
  }

  getAddress(): string {
    return this.keypair.toAddress(this.networkId).toString();
  }

  async signAndBroadcastTx(
    outputs: PaymentOutput[],
    options?: TxSettingOptions,
  ): Promise<string> {
    const { entries } = await this.rpcClient.getUtxosByAddresses([
      this.getAddress(),
    ]);

    const txGenerator = new Generator({
      priorityEntries: options?.priorityEntries?.map((entry) => {
        return toKaspaEntry(entry);
      }),
      entries:
        options?.entries?.map((entry) => {
          return toKaspaEntry(entry);
        }) ?? entries,
      outputs: outputs.map((output) => {
        return {
          address: output.address,
          amount: kaspaToSompi(output.amount) ?? 0n,
        };
      }),
      priorityFee: options?.priorityFee
        ? kaspaToSompi(options.priorityFee)
        : 0n,
      changeAddress: this.getAddress(),
      payload: options?.payload,
      networkId: this.networkId,
    });

    const pending: PendingTransaction = await txGenerator.next();
    if (!pending) {
      throw new Error("No transaction to sign");
    }

    const signed = await this.signTx(pending.transaction, options?.scripts);
    return (await this.rpcClient.submitTransaction({ transaction: signed }))
      .transactionId;
  }

  // NOTE: This method does not support signing with multiple keys
  async signTx(tx: Transaction, scripts?: ScriptOption[]) {
    if (scripts) {
      await Promise.all(
        scripts.map((script) => this.signTxInputWithScript(tx, script)),
      );
    }
    return signTransaction(tx, [this.getPrivateKeyString()], false);
  }

  async signTxInputWithScript(tx: Transaction, script: ScriptOption) {
    // check if the input does exist
    if (tx.inputs.length <= script.inputIndex) {
      throw new Error("Input index out of range");
    }

    // check if the input is not already signed
    if (tx.inputs[script.inputIndex].signatureScript !== "") {
      throw new Error("Input already signed");
    }

    const signature = createInputSignature(
      tx,
      script.inputIndex,
      new PrivateKey(this.getPrivateKeyString()),
      toSignType(script.signType ?? "All"),
    );

    const scriptBuilder = ScriptBuilder.fromScript(script.scriptHex);
    tx.inputs[script.inputIndex].signatureScript =
      scriptBuilder.encodePayToScriptHashSignatureScript(signature);
  }

  private async getUtxos(): Promise<UtxoEntryReference[]> {
    const address = this.getAddress();
    return (
      await this.rpcClient.getUtxosByAddresses({
        addresses: [address],
      })
    ).entries;
  }
}
