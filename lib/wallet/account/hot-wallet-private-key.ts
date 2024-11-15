import {
  Address,
  Generator,
  kaspaToSompi,
  Keypair,
  PrivateKey,
  RpcClient,
  UtxoEntryReference,
} from "@/wasm/core/kaspa";

import { IWallet, PaymentOutput } from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export class HotWalletPrivateKey implements IWallet {
  keypair: Keypair;

  constructor(
    privateKey: PrivateKey,
    private readonly rpc: RpcClient,
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
    const { entries } = await this.rpc.getBalancesByAddresses([address]);

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
      const txid = await pending.submit(this.rpc);
      txIds.push(txid);
    }
    return txIds;
  }

  getAddress(): string {
    return this.keypair.toAddress(this.networkId).toString();
  }

  async signAndBroadcastTx(
    outputs: PaymentOutput[],
    priorityFee?: bigint,
    payload?: Uint8Array,
  ): Promise<string> {
    const txGenerator = new Generator({
      entries: await this.getUtxos(),
      outputs: outputs.map((output) => {
        return {
          address: output.address,
          amount: kaspaToSompi(output.amount) ?? 0n,
        };
      }),
      priorityFee: priorityFee ?? 0n,
      changeAddress: this.getAddress(),
      payload,
      networkId: this.networkId,
    });

    const pending = await txGenerator.next();
    if (!pending) {
      throw new Error("No transaction to sign");
    }

    await pending.sign([this.keypair.privateKey]);
    return await pending.submit(this.rpc);
  }

  private async getUtxos(): Promise<UtxoEntryReference[]> {
    const address = this.getAddress();
    return (
      await this.rpc.getUtxosByAddresses({
        addresses: [address],
      })
    ).entries;
  }
}
