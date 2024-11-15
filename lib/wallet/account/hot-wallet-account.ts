import {
  Address,
  Generator,
  kaspaToSompi,
  PublicKey,
  RpcClient,
  UtxoEntryReference,
  XPrv,
} from "@/wasm/core/kaspa";

import { IWallet, PaymentOutput } from "@/lib/wallet/interface.ts";
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
    let pending;
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

  async signAndBroadcastTx(
    outputs: PaymentOutput[],
    priorityFee?: bigint,
    payload?: Uint8Array,
  ): Promise<string> {
    const amountSum = outputs.reduce(
      (acc, curr) => acc + (kaspaToSompi(curr.amount) ?? 0n),
      0n,
    );

    const [entries, indexes] = await this.getUtxos(amountSum);

    const txGenerator = new Generator({
      entries,
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

    await pending.sign(this.getPrivateKeys(indexes));
    return await pending.submit(this.rpcClient);
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
