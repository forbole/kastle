import {
  Address,
  Generator,
  kaspaToSompi,
  Keypair,
  PrivateKey,
  RpcClient,
  UtxoEntryReference,
  PendingTransaction,
  ScriptBuilder,
} from "@/wasm/core/kaspa";

import {
  IWallet,
  PaymentOutput,
  TransactionOptions,
  toKaspaEntry,
} from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export class HotWalletPrivateKey implements IWallet {
  keypair: Keypair;

  constructor(
    privateKey: PrivateKey,
    private readonly rpcClient: RpcClient,
    private readonly networkId: NetworkType,
  ) {
    this.keypair = privateKey.toKeypair();
  }

  getPrivateKey() {
    return this.keypair.privateKey;
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

  // NOTE: This method does not support signing with multiple keys
  async signAndBroadcastTx(
    outputs: PaymentOutput[],
    options?: TransactionOptions,
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

    // Replace the input script with the provided script
    if (options?.scriptHex) {
      const replaceIndex = pending.transaction.inputs.findIndex(
        (input) => input.signatureScript === "",
      );
      if (replaceIndex === -1) {
        throw new Error("No input to replace");
      }

      const scriptBuilder = ScriptBuilder.fromScript(options.scriptHex);
      const signature = await pending.createInputSignature(
        replaceIndex,
        new PrivateKey(this.getPrivateKey()),
      );

      pending.fillInput(
        replaceIndex,
        scriptBuilder.encodePayToScriptHashSignatureScript(signature),
      );
    }

    await pending.sign([this.getPrivateKey()], false);
    return await pending.submit(this.rpcClient);
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
