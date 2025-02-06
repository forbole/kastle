import {
  Address,
  Generator,
  kaspaToSompi,
  PendingTransaction,
  PrivateKey,
  PublicKey,
  RpcClient,
  ScriptBuilder,
  UtxoEntryReference,
  XPrv,
  Transaction,
  createInputSignature,
  signTransaction,
} from "@/wasm/core/kaspa";

import {
  IWallet,
  PaymentOutput,
  ScriptOption,
  TxSettingOptions,
  toKaspaEntry,
  toSignType,
} from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export class HotWalletAccount implements IWallet {
  private readonly MAX_DERIVATION_INDEXES = 50;

  constructor(
    private readonly seed: string,
    private readonly accountIndex: number,
    private readonly rpcClient: RpcClient,
    private readonly networkId: NetworkType,
  ) {}

  public getPrivateKey() {
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
      for (const script of scripts) {
        await this.signTxInputWithScript(tx, script);
      }
      return await signTransaction(tx, [this.getPrivateKey()], false);
    }
    return await signTransaction(tx, [this.getPrivateKey()], true);
  }

  async signTxWithScripts(tx: Transaction, scripts: ScriptOption[]) {
    for (const script of scripts) {
      await this.signTxInputWithScript(tx, script);
    }
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

    const signature = await createInputSignature(
      tx,
      script.inputIndex,
      new PrivateKey(this.getPrivateKey()),
      toSignType(script.signType ?? "All"),
    );

    const scriptBuilder = ScriptBuilder.fromScript(script.scriptHex);
    tx.inputs[script.inputIndex].signatureScript =
      scriptBuilder.encodePayToScriptHashSignatureScript(signature);
    return tx;
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
