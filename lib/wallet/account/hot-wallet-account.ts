import {
  Address,
  addressFromScriptPublicKey,
  createInputSignature,
  createTransactions,
  Generator,
  IGeneratorSettingsObject,
  IPaymentOutput,
  kaspaToSompi,
  PendingTransaction,
  PrivateKey,
  PublicKey,
  RpcClient,
  ScriptBuilder,
  signTransaction,
  Transaction,
  UtxoEntryReference,
  XPrv,
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
import { sleep } from "@/lib/utils.ts";

export class HotWalletAccount implements IWallet {
  private readonly MAX_DERIVATION_INDEXES = 50;

  constructor(
    private readonly seed: string,
    private readonly accountIndex: number,
    private readonly rpcClient: RpcClient,
    private readonly networkId: NetworkType,
  ) {}

  async *performCommitReveal(
    scriptBuilder: ScriptBuilder,
    revealPriorityFee: IGeneratorSettingsObject["priorityFee"],
    extraOutputs: IPaymentOutput[] = [],
  ) {
    yield "commiting";

    const privateKey = this.getPrivateKey();
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

      addedEventTxId =
        addedEntry?.outpoint?.transactionId ??
        removedEntry?.outpoint?.transactionId;

      if (addedEventTxId == submittedTxId) {
        eventReceived = true;
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

    for (let i = 0; i < 240; i++) {
      await sleep(500);

      if (eventReceived) {
        break;
      }
    }
    if (!eventReceived) {
      throw new Error("Commit transaction did not mature within 2 minutes");
    }

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

    for (let i = 0; i < 240; i++) {
      await sleep(500);

      if (eventReceived) {
        break;
      }
    }
    if (!eventReceived) {
      throw new Error("Reveal transaction did not mature within 2 minutes");
    }

    this.rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
    eventReceived = false;
  }

  public getPrivateKeyString() {
    const xprv = new XPrv(this.seed);
    const privateKey = xprv
      .derivePath(`m/44'/111111'/${this.accountIndex}'/0/0`)
      .toPrivateKey();

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

  async getBalance(): Promise<bigint> {
    const { entries } = await this.rpcClient.getBalancesByAddresses(
      this.getAccountAddresses(),
    );

    return entries.reduce((acc, curr) => acc + curr.balance, 0n);
  }

  async send(amount: bigint, receiverAddress: string): Promise<string[]> {
    if (!Address.validate(receiverAddress)) {
      throw new Error("Invalid receiver address " + receiverAddress);
    }

    const [entries, indexes] = await this.getUtxos(amount);

    const txGenerator = new Generator({
      entries: entries,
      outputs: [
        {
          address: receiverAddress,
          amount,
        },
      ],
      priorityFee: 0n,
      changeAddress: this.getAddress(),
      networkId: this.networkId,
    });

    const txIds = [];
    let pending: PendingTransaction;
    while ((pending = await txGenerator.next())) {
      await pending.sign(this.getPrivateKeys(indexes));
      const txid = await pending.submit(this.rpcClient);
      txIds.push(txid);
    }
    return txIds;
  }

  getAddress(): string {
    const xprv = new XPrv(this.seed);
    const privateKey = xprv
      .derivePath(`m/44'/111111'/${this.accountIndex}'/0/0`)
      .toPrivateKey();

    return privateKey.toKeypair().toAddress(this.networkId).toString();
  }

  // NOTE: This method does not support signing with multiple keys
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
    if (tx.inputs[script.inputIndex].signatureScript) {
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

  getPublicKey(): PublicKey {
    return this.getPrivateKey().toPublicKey();
  }

  private getPrivateKey() {
    const xprv = new XPrv(this.seed);
    return xprv
      .derivePath(`m/44'/111111'/${this.accountIndex}'/0/0`)
      .toPrivateKey();
  }

  private getPrivateKeys(indexes: number[]) {
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

  private getAccountAddresses() {
    return this.getPublicKeys().map((publicKey) => {
      return new PublicKey(publicKey).toAddress(this.networkId).toString();
    });
  }

  private async getUtxos(amount?: bigint) {
    const rpcResult = await this.rpcClient.getUtxosByAddresses(
      this.getAccountAddresses(),
    );

    const entries: UtxoEntryReference[] = [];
    const indexes: number[] = [];
    let sum = 0n;

    for (let i = 0; i < rpcResult.entries.length; i++) {
      const utxoEntry = rpcResult.entries[i];
      sum += utxoEntry.amount;
      entries.push(utxoEntry);
      indexes.push(i);

      if (!!amount && sum > amount) {
        break;
      }
    }

    // TODO handle amount sum < amount?

    return [entries, indexes] as const;
  }
}
