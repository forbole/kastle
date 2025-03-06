import {
  Address,
  addressFromScriptPublicKey,
  createInputSignature,
  createTransactions,
  Generator,
  IUtxoEntry,
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
  TxSettingOptions,
} from "@/lib/wallet/wallet-interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { Amount, Fee } from "@/lib/krc20.ts";
import {
  toKaspaEntry,
  toKaspaPaymentOutput,
  toSignType,
  waitTxForAddress,
} from "@/lib/kaspa.ts";

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
    revealPriorityFee: string,
    extraOutputs: PaymentOutput[] = [],
  ) {
    const p2SHAddress = addressFromScriptPublicKey(
      scriptBuilder.createPayToScriptHashScript(),
      this.networkId,
    );

    if (!p2SHAddress) {
      throw new Error("Invalid P2SH address");
    }

    yield {
      status: "committing" as const,
    };

    const { transactionId: commitTxId, confirm: commitTxIdConfirm } =
      await this.commitScript(p2SHAddress.toString());

    // Wait for the commit transaction to be added to the UTXO set of the address
    // TODO: yield failed status and retry if timeout
    await commitTxIdConfirm;

    yield {
      status: "revealing" as const,
      commitTxId: commitTxId,
    };

    // Create the reveal transaction
    const scriptUTXOs = await this.rpcClient.getUtxosByAddresses({
      addresses: [p2SHAddress.toString()],
    });

    const scriptUtxo = scriptUTXOs.entries.find(
      (entry) => entry.outpoint.transactionId === commitTxId,
    );

    if (!scriptUtxo) {
      throw new Error("Could not find script UTXO");
    }

    const { transactionId: revealTxId, confirm: revealTxIdConfirm } =
      await this.revealScript(
        scriptBuilder,
        scriptUtxo,
        revealPriorityFee,
        extraOutputs,
      );

    // Wait for the reveal transaction to be removed to the UTXO set of the P2SH address
    // TODO: yield failed status and retry if timeout
    await revealTxIdConfirm;

    yield {
      status: "completed" as const,
      commitTxId: commitTxId,
      revealTxId: revealTxId,
    };
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

  private async commitScript(p2SHAddress: string) {
    const publicKey = this.getPublicKey();
    const address = publicKey.toAddress(this.networkId);

    // Create the commit transaction
    const { entries } = await this.rpcClient.getUtxosByAddresses({
      addresses: [address.toString()],
    });
    const { transactions: pendingTxs } = await createTransactions({
      priorityEntries: [],
      entries,
      outputs: [
        {
          address: p2SHAddress,
          amount: kaspaToSompi(Amount.ScriptUtxoAmount)!,
        },
      ],
      priorityFee: kaspaToSompi(Fee.Base.toString())!,
      changeAddress: address.toString(),
      networkId: this.networkId,
    });

    const pending = pendingTxs[0];
    const signedTx = await this.signTx(pending.transaction);

    const confirm = waitTxForAddress(this.rpcClient, p2SHAddress, signedTx.id);

    const { transactionId } = await this.rpcClient.submitTransaction({
      transaction: signedTx,
    });

    return {
      transactionId,
      confirm,
    };
  }

  private async revealScript(
    script: ScriptBuilder,
    scriptUtxo: IUtxoEntry,
    priorityFee: string,
    extraOutputs: PaymentOutput[] = [],
  ) {
    const address = this.getAddress();
    const { entries } = await this.rpcClient.getUtxosByAddresses([address]);

    const { transactions: revealPendingTxs } = await createTransactions({
      priorityEntries: [scriptUtxo],
      entries,
      outputs: extraOutputs.map((output) => toKaspaPaymentOutput(output)),
      changeAddress: address,
      priorityFee: kaspaToSompi(priorityFee),
      networkId: this.networkId,
    });

    // Sign the transaction with the script
    const pendingTx = revealPendingTxs[0];
    const signedTx = await this.signTx(pendingTx.transaction, [
      {
        inputIndex: 0,
        scriptHex: script.toString(),
      },
    ]);

    const confirm = waitTxForAddress(this.rpcClient, address, signedTx.id);

    const { transactionId } = await this.rpcClient.submitTransaction({
      transaction: signedTx,
    });

    return {
      transactionId,
      confirm,
    };
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
