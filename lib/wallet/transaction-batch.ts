import { RpcClient, Transaction } from "@/wasm/core/kaspa";
import { IWalletWithGetAddress } from "@/lib/wallet/wallet-interface";

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
