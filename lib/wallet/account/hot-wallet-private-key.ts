import {
  Address,
  addressFromScriptPublicKey,
  createInputSignature,
  createTransactions,
  Generator,
  IUtxoEntry,
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
    // TODO: yield failed status if timeout
    await revealTxIdConfirm;

    yield {
      status: "completed" as const,
      commitTxId: commitTxId,
      revealTxId: revealTxId,
    };
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

    const confirm = waitTxForAddress(
      this.rpcClient,
      address.toString(),
      signedTx.id,
    );

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

  private async getUtxos(): Promise<UtxoEntryReference[]> {
    const address = this.getAddress();
    return (
      await this.rpcClient.getUtxosByAddresses({
        addresses: [address],
      })
    ).entries;
  }
}
