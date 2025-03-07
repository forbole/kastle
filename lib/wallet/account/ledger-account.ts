import {
  CommitRevealResult,
  IWallet,
  PaymentOutput,
} from "@/lib/wallet/wallet-interface.ts";
import {
  Address,
  Generator,
  IGeneratorSettingsObject,
  IUtxoEntry,
  PendingTransaction,
  PublicKey,
  RpcClient,
  ScriptBuilder,
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

export class LedgerAccount implements IWallet {
  private readonly app: KaspaApp;
  private readonly path: string;

  constructor(
    transport: Transport,
    accountIndex: number,
    private readonly rpcClient: RpcClient,
    private readonly networkId: string,
  ) {
    this.app = new KaspaApp(transport);
    this.path = `m/44'/111111'/${accountIndex}'/0/0`;
  }

  performCommitReveal(
    scriptBuilder: ScriptBuilder,
    revealPriorityFee: string,
    extraOutputs?: PaymentOutput[],
  ): AsyncGenerator<CommitRevealResult> {
    throw new Error("Method not implemented.");
  }

  public async send(
    amount: bigint,
    receiverAddress: string,
    priorityFee?: bigint,
  ): Promise<string[]> {
    if (!Address.validate(receiverAddress)) {
      throw new Error("Invalid receiver address " + receiverAddress);
    }

    const entries = await this.getUtxos();

    const txGenerator = new Generator({
      entries: entries,
      outputs: [
        {
          address: receiverAddress,
          amount,
        },
      ],
      priorityFee: 0n,
      changeAddress: await this.getAddress(),
      networkId: this.networkId,
    });

    const txIds = [];
    let pending;
    while ((pending = (await txGenerator.next()) as PendingTransaction)) {
      const inputs = pending.transaction.inputs;

      const ledgerInputs = inputs.map(
        (input) =>
          new LedgerTransactionInput({
            value: Number(input.utxo?.amount),
            prevTxId: input.utxo?.outpoint.transactionId ?? "",
            outpointIndex: input.utxo?.outpoint.index ?? 0,
            addressType: 0,
            addressIndex: 0,
          }),
      );

      const outputs = pending.transaction.outputs.map(
        (output) =>
          new LedgerTransactionOutput({
            value: Number(output.value),
            scriptPublicKey:
              typeof output.scriptPublicKey === "string"
                ? output.scriptPublicKey
                : output.scriptPublicKey.script,
          }),
      );

      const tx = new LedgerTransaction({
        version: 0,
        inputs: ledgerInputs,
        outputs: outputs,

        changeAddressType: 0,
        changeAddressIndex: 0,
      });

      await this.app.signTransaction(tx);

      const rpcTx = this.toRpcTransaction(tx);
      const { transactionId } = await this.rpcClient.submitTransaction({
        transaction: rpcTx,
      });
      txIds.push(transactionId);
    }

    return txIds;
  }

  public getPrivateKeyString(): string {
    throw new Error("Ledger wallet does not support getPrivateKey");
  }

  getPublicKey(): PublicKey {
    throw new Error("Ledger wallet does not support getPublicKey");
  }

  public async getPublicKeys(): Promise<string[]> {
    const response = await this.app.getPublicKey(this.path, false);
    // Index 0 is the length of the following full public key
    const keyLength: number = response.readUInt8(0);

    const publicKeyBuffer = response.subarray(1, keyLength + 1);
    return [publicKeyBuffer.toString("hex")];
  }

  public async getBalance(): Promise<bigint> {
    const address = await this.getAddress();
    const { entries } = await this.rpcClient.getBalancesByAddresses([address]);

    return entries.reduce((acc, curr) => acc + curr.balance, 0n);
  }

  public async getAddress(): Promise<string> {
    const publicKey = new PublicKey((await this.getPublicKeys())[0]);

    return publicKey
      .toAddress((await this.rpcClient.getCurrentNetwork()).network)
      .toString();
  }

  public async signTx(tx: Transaction): Promise<Transaction> {
    throw new Error("Method not implemented.");
  }

  private async getUtxos(): Promise<IUtxoEntry[]> {
    const address = await this.getAddress();
    return (
      await this.rpcClient.getUtxosByAddresses({
        addresses: [address],
      })
    ).entries;
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
