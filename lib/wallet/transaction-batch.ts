import { RpcClient, Transaction } from "@/wasm/core/kaspa";
import { IWalletWithGetAddress } from "@/lib/wallet/wallet-interface";

/**
 * The signer left inputs without a signature script: a local signing failure,
 * not a node rejection. Thrown before the transaction is submitted; earlier
 * transactions of the same batch may already have landed.
 */
export class UnsignedInputsError extends Error {
  constructor(
    readonly unsigned: number,
    readonly total: number,
  ) {
    super(
      `${unsigned} of ${total} inputs are unsigned; this transaction was not submitted.`,
    );
    this.name = "UnsignedInputsError";
  }
}

/**
 * `createTransactions` wraps the WASM `Generator`, which returns a daisy-chained
 * *batch* rather than a single transaction whenever the UTXO set is too fragmented
 * for the requested amount to fit in one transaction's mass budget: compound
 * transactions that sweep selected UTXOs into the change address come first, and
 * the actual payment is last (see `Generator` in `wasm/core/kaspa.d.ts`).
 *
 * Signing only `transactions[0]` therefore broadcasts a compound transaction that
 * pays the sender's own change address, charges a real fee, and never pays the
 * recipient. Every transaction must be signed and submitted in array order,
 * because each one spends the output of the one before it.
 *
 * @returns the ids of every broadcast transaction, in order; the last is the payment.
 */
export async function signAndSubmitBatch(
  transactions: readonly { transaction: Transaction }[],
  signer: Pick<IWalletWithGetAddress, "signTx">,
  rpcClient: Pick<RpcClient, "submitTransaction">,
  callbacks: {
    onSigning?: (current: number, total: number) => void;
    onSubmitted?: (transactionIds: string[]) => void;
  } = {},
): Promise<string[]> {
  if (transactions.length === 0) {
    throw new Error("No transaction was generated for this amount");
  }

  const transactionIds: string[] = [];
  for (const [index, pending] of transactions.entries()) {
    callbacks.onSigning?.(index + 1, transactions.length);
    const signedTransaction = await signer.signTx(pending.transaction);
    // A signer leaves inputs it holds no key for with an empty script and no
    // error; the node would reject them. Stop before this one goes out.
    const unsigned = signedTransaction.inputs.filter(
      (input) => !input.signatureScript?.length,
    ).length;
    if (unsigned > 0) {
      throw new UnsignedInputsError(unsigned, signedTransaction.inputs.length);
    }
    const { transactionId } = await rpcClient.submitTransaction({
      transaction: signedTransaction,
    });
    transactionIds.push(transactionId);
    // Publish ids as they land, so a mid-batch failure still shows which
    // transactions were broadcast — and paid for — on the failure screen.
    callbacks.onSubmitted?.([...transactionIds]);
  }

  return transactionIds;
}
