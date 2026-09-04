import {
  Address,
  IUtxoEntry,
  kaspaToSompi,
  RpcClient,
  createTransactions,
  ScriptBuilder,
  addressFromScriptPublicKey,
  PendingTransaction,
  Transaction,
} from "@/wasm/core/kaspa";
import { PaymentOutput, IWallet } from "@/lib/wallet/wallet-interface.ts";
import { toKaspaPaymentOutput } from "./kaspa";
import { calcRevealInputFee, calcRevealInputMass } from "./kaspaFee";

export const SCRIPT_UTXO_AMOUNT = "0.3";

// rusty-kaspa MAXIMUM_STANDARD_TRANSACTION_MASS: the mempool rejects anything
// heavier at submit. Checked before the commit is broadcast so a too-large
// reveal never strands the script UTXO.
export const MAX_STANDARD_TRANSACTION_MASS = 100_000n;

const REVEAL_CONFIRMATION_TIMEOUT_MS = 120_000;

// WASM (Generator, RpcClient) rejects with plain strings, not Error objects.
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/**
 * Thrown when a reveal batch is only partially broadcast. `transactionIds` are
 * the reveal transactions that did land, in order — they are paid for and
 * on-chain, so the failure screen must be able to show them.
 */
export class RevealBroadcastError extends Error {
  constructor(
    readonly cause: unknown,
    readonly transactionIds: string[],
    readonly total: number,
  ) {
    super(
      `Reveal broadcast failed after ${transactionIds.length}/${total} transactions: ${errorMessage(cause)}`,
    );
    this.name = "RevealBroadcastError";
  }
}

export class CommitRevealHelper {
  constructor(
    private readonly signer: IWallet,
    private readonly rpcClient: RpcClient,
    private readonly networkId: string,
    private readonly scriptBuilder: ScriptBuilder,
    private readonly options: { confirmationTimeoutMs?: number } = {},
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

    // Pre-flight: prove the reveal is buildable BEFORE anything is broadcast.
    // Every reveal-leg throw after the commit strands the 0.3 KAS script UTXO
    // at a P2SH the wallet keeps no record of.
    await this.preflightReveal(p2SHAddress, revealPriorityFee, extraOutputs);

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

    const scriptUtxo = await this.findScriptUtxo(
      p2SHAddress.toString(),
      commitTxId,
    );

    const { transactionIds: revealTxIds, confirm: revealConfirm } =
      await this.revealScript(
        this.scriptBuilder,
        scriptUtxo,
        p2SHAddress.toString(),
        revealPriorityFee,
        extraOutputs,
      );

    // Wait for the final reveal transaction to be accepted
    // TODO: yield failed status and retry if timeout
    await revealConfirm;

    yield {
      status: "completed" as const,
      commitTxId: commitTxId,
      // The Generator may split the reveal into a daisy-chained batch; the
      // payment (and the priority fee) is on the LAST transaction.
      revealTxId: revealTxIds[revealTxIds.length - 1],
      revealTxIds,
    };
  }

  private async userAddress() {
    return (await this.signer.getPublicKey())
      .toAddress(this.networkId)
      .toString();
  }

  private createCommitTransactions(
    entries: IUtxoEntry[],
    address: string,
    p2SHAddress: string,
  ) {
    return createTransactions({
      priorityEntries: [],
      entries,
      outputs: [
        {
          address: p2SHAddress,
          amount: kaspaToSompi(SCRIPT_UTXO_AMOUNT)!,
        },
      ],
      priorityFee: 0n,
      changeAddress: address,
      networkId: this.networkId,
    });
  }

  /**
   * Builds the commit offline, derives the post-commit UTXO set from it, and
   * builds the reveal batch against that set plus a synthetic script UTXO.
   * Nothing is signed or broadcast. Throws the Generator's own error
   * ("Insufficient funds", "Mass calculation error", "Storage mass exceeds
   * maximum", …) or the mass-headroom error, so the caller fails before the
   * commit instead of after it.
   */
  private async preflightReveal(
    p2SHAddress: Address,
    priorityFee: string,
    extraOutputs: PaymentOutput[],
  ) {
    const address = await this.userAddress();
    const { entries } = await this.rpcClient.getUtxosByAddresses([address]);

    const { transactions: commitTxs } = await this.createCommitTransactions(
      entries,
      address,
      p2SHAddress.toString(),
    );
    if (commitTxs.length !== 1) {
      throw new Error(
        `Commit would need ${commitTxs.length} transactions; the wallet's UTXO set is too fragmented`,
      );
    }
    const commit = commitTxs[0].transaction;
    const p2shScript = this.scriptBuilder.createPayToScriptHashScript();
    const p2shScriptHex = p2shScript.toString();

    // The reveal will see the wallet minus what the commit spends, plus the
    // commit's change. Model that set rather than the current one.
    const spent = new Set(
      commit.inputs.map(
        (input) =>
          `${input.previousOutpoint.transactionId}:${input.previousOutpoint.index}`,
      ),
    );
    const userPayload = new Address(address).payload;
    const predictedEntries: IUtxoEntry[] = entries.filter(
      (entry) =>
        !spent.has(`${entry.outpoint.transactionId}:${entry.outpoint.index}`),
    );
    let scriptOutputIndex = -1;
    commit.outputs.forEach((output, index) => {
      const scriptHex = output.scriptPublicKey.toString();
      if (scriptHex === p2shScriptHex) {
        scriptOutputIndex = index;
        return;
      }
      const outputAddress = addressFromScriptPublicKey(
        output.scriptPublicKey,
        this.networkId,
      );
      if (outputAddress?.payload === userPayload) {
        predictedEntries.push({
          address: outputAddress,
          outpoint: { transactionId: commit.id, index },
          amount: output.value,
          scriptPublicKey: output.scriptPublicKey,
          blockDaaScore: 0n,
          isCoinbase: false,
        });
      }
    });
    if (scriptOutputIndex < 0) {
      throw new Error("Commit transaction does not pay the P2SH address");
    }

    const syntheticScriptUtxo: IUtxoEntry = {
      address: p2SHAddress,
      outpoint: { transactionId: commit.id, index: scriptOutputIndex },
      amount: kaspaToSompi(SCRIPT_UTXO_AMOUNT)!,
      scriptPublicKey: p2shScript,
      blockDaaScore: 0n,
      isCoinbase: false,
    };

    try {
      await this.buildReveal(
        this.scriptBuilder,
        syntheticScriptUtxo,
        predictedEntries,
        address,
        priorityFee,
        extraOutputs,
      );
    } catch (e) {
      // The Generator rejects with a plain string; keep its text (callers
      // match on it) but make the stage unmistakable.
      throw new Error(
        `Reveal transaction cannot be built, nothing was committed: ${errorMessage(e)}`,
      );
    }
  }

  private async findScriptUtxo(p2SHAddress: string, commitTxId: string) {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }

      const scriptUTXOs = await this.rpcClient.getUtxosByAddresses({
        addresses: [p2SHAddress],
      });

      const scriptUtxo = scriptUTXOs.entries.find(
        (entry) => entry.outpoint.transactionId === commitTxId,
      );
      if (scriptUtxo) {
        return scriptUtxo;
      }
    }
    throw new Error("Could not find script UTXO");
  }

  private async commitScript(p2SHAddress: string) {
    const address = (await this.signer.getPublicKey()).toAddress(
      this.networkId,
    );

    // Create the commit transaction
    const { entries } = await this.rpcClient.getUtxosByAddresses({
      addresses: [address.toString()],
    });
    const { transactions: pendingTxs } = await this.createCommitTransactions(
      entries,
      address.toString(),
      p2SHAddress,
    );

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

  /**
   * Runs the Generator for the reveal and validates the batch it returns.
   * Shared by the pre-flight (synthetic script UTXO) and the real reveal, so
   * both see the same checks.
   */
  private async buildReveal(
    script: ScriptBuilder,
    scriptUtxo: IUtxoEntry,
    entries: IUtxoEntry[],
    address: string,
    priorityFee: string,
    extraOutputs: PaymentOutput[],
  ): Promise<PendingTransaction[]> {
    const scriptHex = script.toString();
    const revealInputFee = calcRevealInputFee(scriptHex);

    const { transactions } = await createTransactions({
      priorityEntries: [scriptUtxo],
      entries,
      outputs: extraOutputs.map((output) => toKaspaPaymentOutput(output)),
      changeAddress: address,
      priorityFee: (kaspaToSompi(priorityFee ?? "0") ?? 0n) + revealInputFee,
      networkId: this.networkId,
      sigOpCount: 1, // P2SH redeem script contains one OpCheckSig
    });

    if (transactions.length === 0) {
      throw new Error("No reveal transaction was generated");
    }

    // The redeem script is signed at input 0 of transactions[0]. That is where
    // the Generator puts priorityEntries, but nothing else guarantees it, so
    // fail closed rather than sign the wrong input.
    const first = transactions[0].transaction.inputs[0]?.previousOutpoint;
    if (
      first?.transactionId !== scriptUtxo.outpoint.transactionId ||
      first?.index !== scriptUtxo.outpoint.index
    ) {
      throw new Error(
        "Reveal transaction does not spend the script UTXO at input 0",
      );
    }

    // The Generator sized input 0 with a standard signature script; the P2SH
    // signature script also carries the redeem script. A batched
    // transactions[0] is already within ~1% of the ceiling.
    const mass = transactions[0].mass + calcRevealInputMass(scriptHex);
    if (mass > MAX_STANDARD_TRANSACTION_MASS) {
      throw new Error(
        `Reveal transaction mass ${mass} exceeds the standard limit of ${MAX_STANDARD_TRANSACTION_MASS}; the script is too large for this wallet's UTXO set`,
      );
    }

    return transactions;
  }

  private async revealScript(
    script: ScriptBuilder,
    scriptUtxo: IUtxoEntry,
    p2SHAddress: string,
    priorityFee: string,
    extraOutputs: PaymentOutput[] = [],
  ) {
    const address = await this.userAddress();
    const { entries } = await this.rpcClient.getUtxosByAddresses([address]);

    const transactions = await this.buildReveal(
      script,
      scriptUtxo,
      entries,
      address,
      priorityFee,
      extraOutputs,
    );

    // Sign everything before broadcasting anything: only transactions[0]
    // spends the P2SH and gets the redeem script; the rest of the chain is
    // plain change and is signed with the key alone. The scripts option is
    // per transaction, so it is keyed by index here.
    const scriptHex = script.toString();
    const signed: Transaction[] = [];
    for (const [index, pending] of transactions.entries()) {
      signed.push(
        await this.signer.signTx(
          pending.transaction,
          index === 0 ? [{ inputIndex: 0, scriptHex }] : undefined,
        ),
      );
    }

    // Success means the FINAL transaction was accepted. Its outputs may fold
    // entirely into fee, so also accept the node reporting any of its inputs
    // as spent — those outpoints are known now, before broadcast.
    const final = signed[signed.length - 1];
    const finalId = final.id;
    const finalInputs = final.inputs.map((input) => ({
      transactionId: input.previousOutpoint.transactionId,
      index: input.previousOutpoint.index,
    }));
    const confirm = waitForUtxosChanged(
      this.rpcClient,
      [address, p2SHAddress],
      (added, removed) =>
        added.some((entry) => entry.outpoint.transactionId === finalId) ||
        removed.some((entry) =>
          finalInputs.some(
            (outpoint) =>
              outpoint.transactionId === entry.outpoint.transactionId &&
              outpoint.index === entry.outpoint.index,
          ),
        ),
      this.options.confirmationTimeoutMs ?? REVEAL_CONFIRMATION_TIMEOUT_MS,
    );

    // Submit in order: later transactions spend the outputs of earlier ones.
    // An orphan error means the node has not seen a parent yet, so retry
    // the SAME index. Never rebuild — once transactions[0] lands the script
    // UTXO is spent and a rebuilt batch would be a plain send of the user's
    // own change.
    const MAX_ORPHAN_RETRIES = 5;
    const transactionIds: string[] = [];
    let orphanRetries = 0;
    while (transactionIds.length < signed.length) {
      try {
        const { transactionId } = await this.rpcClient.submitTransaction({
          transaction: signed[transactionIds.length],
        });
        transactionIds.push(transactionId);
        orphanRetries = 0;
      } catch (e) {
        const isOrphan = errorMessage(e).toLowerCase().includes("orphan");
        if (isOrphan && orphanRetries < MAX_ORPHAN_RETRIES) {
          orphanRetries++;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * orphanRetries),
          );
          continue;
        }
        // Nobody awaits the watcher now; let its own timeout end it quietly.
        confirm.catch(() => undefined);
        throw new RevealBroadcastError(e, transactionIds, signed.length);
      }
    }

    return {
      transactionIds,
      confirm,
    };
  }
}

const CONFIRMATION_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Resolves on the first `utxos-changed` event, restricted to `addresses`, for
 * which `isMatch(added, removed)` is true. Rejects with "Timeout" otherwise.
 */
export const waitForUtxosChanged = async (
  rpcClient: RpcClient,
  addresses: string[],
  isMatch: (added: IUtxoEntry[], removed: IUtxoEntry[]) => boolean,
  timeoutMs = CONFIRMATION_TIMEOUT_MS,
) => {
  const payloads = new Set(addresses.map((a) => new Address(a).payload));
  const forAddresses = (entries: IUtxoEntry[] = []) =>
    entries.filter((entry) => payloads.has(entry.address?.payload ?? ""));

  try {
    await rpcClient.subscribeUtxosChanged(addresses);

    await new Promise<void>((resolve, reject) => {
      const handleUtxosChanged = (event: any) => {
        if (
          isMatch(
            forAddresses(event.data.added),
            forAddresses(event.data.removed),
          )
        ) {
          clearTimeout(timer);
          rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
          resolve();
        }
      };

      rpcClient.addEventListener("utxos-changed", handleUtxosChanged);
      const timer = setTimeout(() => {
        rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
        reject(new Error("Timeout"));
      }, timeoutMs);
    });
  } finally {
    await rpcClient.unsubscribeUtxosChanged(addresses);
  }
};

// Wait for the transaction to be added to (or spent from) the UTXO set of the address
export const waitTxForAddress = (
  rpcClient: RpcClient,
  address: string,
  txId: string,
) => {
  const byId = (entry: IUtxoEntry) => entry.outpoint.transactionId === txId;
  // `.some`, not `.find`: one event can carry several entries for the address
  // and the matching one need not be first.
  return waitForUtxosChanged(
    rpcClient,
    [address],
    (added, removed) => added.some(byId) || removed.some(byId),
  );
};
