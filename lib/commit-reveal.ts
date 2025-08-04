import {
  Address,
  IUtxoEntry,
  kaspaToSompi,
  RpcClient,
  createTransactions,
  ScriptBuilder,
  addressFromScriptPublicKey,
} from "@/wasm/core/kaspa";
import { PaymentOutput, IWallet } from "@/lib/wallet/wallet-interface.ts";
import { toKaspaPaymentOutput } from "./kaspa";

export const COMMIT_FEE = "0.001"; // 0.001 KAS
export const SCRIPT_UTXO_AMOUNT = "0.3";

export class CommitRevealHelper {
  constructor(
    private readonly signer: IWallet,
    private readonly rpcClient: RpcClient,
    private readonly networkId: string,
    private readonly scriptBuilder: ScriptBuilder,
  ) {}

  async *perform(
    revealPriorityFee: string,
    extraOutputs: PaymentOutput[] = [],
  ) {
    const p2SHAddress = addressFromScriptPublicKey(
      this.scriptBuilder.createPayToScriptHashScript(),
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
        this.scriptBuilder,
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

  private async commitScript(p2SHAddress: string) {
    const address = (await this.signer.getPublicKey()).toAddress(
      this.networkId,
    );

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
          amount: kaspaToSompi(SCRIPT_UTXO_AMOUNT)!,
        },
      ],
      priorityFee: kaspaToSompi(COMMIT_FEE)!,
      changeAddress: address.toString(),
      networkId: this.networkId,
    });

    const pending = pendingTxs[0];
    const signedTx = await this.signer.signTx(pending.transaction);

    // Register the waiting callback for the transaction confirmation
    // This must be executed before submitting the transaction then awaiting for the confirmation after submitting to avoid missing the event
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
    const address = (await this.signer.getPublicKey())
      .toAddress(this.networkId)
      .toString();
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
    const signedTx = await this.signer.signTx(pendingTx.transaction, [
      {
        inputIndex: 0,
        scriptHex: script.toString(),
      },
    ]);

    // Register the waiting callback for the transaction confirmation
    // This must be executed before submitting the transaction then awaiting for the confirmation after submitting to avoid missing the event
    const confirm = waitTxForAddress(this.rpcClient, address, signedTx.id);

    const { transactionId } = await this.rpcClient.submitTransaction({
      transaction: signedTx,
    });

    return {
      transactionId,
      confirm,
    };
  }
}

// Wait for the transaction to be added to the UTXO set of the address
export const waitTxForAddress = async (
  rpcClient: RpcClient,
  address: string,
  txId: string,
) => {
  try {
    await rpcClient.subscribeUtxosChanged([address]);

    await new Promise<void>((resolve, reject) => {
      const handleUtxosChanged = (event: any) => {
        const addedEntry: IUtxoEntry = event.data.added.find(
          (entry: IUtxoEntry) =>
            entry.address?.payload === new Address(address).payload,
        );

        const removedEntry: IUtxoEntry = event.data.removed.find(
          (entry: IUtxoEntry) =>
            entry.address?.payload === new Address(address).payload,
        );

        const isEventReceived =
          addedEntry?.outpoint.transactionId === txId ||
          removedEntry?.outpoint.transactionId === txId;

        if (isEventReceived) {
          rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
          resolve();
        }
      };

      rpcClient.addEventListener("utxos-changed", handleUtxosChanged);
      setTimeout(() => {
        rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
        reject(new Error("Timeout"));
      }, 120000); // 2 minutes
    });
  } finally {
    await rpcClient.unsubscribeUtxosChanged([address]);
  }
};
