import {
  createTransactions,
  IGeneratorSettingsObject,
  IUtxoEntry,
  PendingTransaction,
} from "@/wasm/core/kaspa";
import { orderEntries } from "@/lib/sendFee";

// The Generator batches at 89 inputs of this shape; 80 leaves ~10% mass
// headroom so every chunk builds as a single transaction.
const DEFAULT_INPUTS_PER_TRANSACTION = 80;

// Ledger signs at most two outputs per transaction.
const MAX_OUTPUTS = 2;

export type ConsolidationPlan = {
  transactions: PendingTransaction[];
  // summary.fees summed across every chunk
  fee: bigint;
  inputCount: number;
  outputCount: number;
};

export class ConsolidationError extends Error {
  constructor(
    readonly code: "no-entries" | "chunk-batched" | "too-many-outputs",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Plans one consolidation round: entries ordered largest first, split into
 * disjoint chunks of `inputsPerTransaction`, each swept to `changeAddress`.
 *
 * The Generator sweeps only when `outputs` and `priorityFee` are both absent.
 * `outputs: []` is a zero-amount payment that spends a single input, and any
 * priorityFee, 0n included, throws "Fees::SenderPays or Fees::ReceiverPays are
 * not allowed in sweep transactions".
 *
 * Returns undefined when the wallet already fits in a single transaction.
 */
export async function planConsolidation({
  entries,
  changeAddress,
  networkId,
  inputsPerTransaction = DEFAULT_INPUTS_PER_TRANSACTION,
}: {
  entries: readonly IUtxoEntry[];
  changeAddress: string;
  networkId: string;
  inputsPerTransaction?: number;
}): Promise<ConsolidationPlan | undefined> {
  if (!entries.length) {
    throw new ConsolidationError("no-entries", "No UTXOs to consolidate");
  }
  if (entries.length <= inputsPerTransaction) return undefined;

  const ordered = orderEntries(entries);
  const transactions: PendingTransaction[] = [];
  let fee = 0n;
  let inputCount = 0;

  for (let start = 0; start < ordered.length; start += inputsPerTransaction) {
    const chunk = ordered.slice(start, start + inputsPerTransaction);
    // A lone remainder is already one UTXO: the Generator builds nothing for
    // it, so it stays out of the round.
    if (chunk.length === 1) break;
    // The typings require `outputs`; omitting it is what selects a sweep.
    const built = await createTransactions({
      entries: chunk,
      changeAddress,
      networkId,
    } as unknown as IGeneratorSettingsObject);
    if (built.transactions.length !== 1) {
      throw new ConsolidationError(
        "chunk-batched",
        `Chunk of ${chunk.length} inputs built ${built.transactions.length} transactions`,
      );
    }
    const [transaction] = built.transactions;
    const outputs = transaction.transaction.outputs.length;
    if (outputs > MAX_OUTPUTS) {
      throw new ConsolidationError(
        "too-many-outputs",
        `Chunk transaction has ${outputs} outputs`,
      );
    }
    transactions.push(transaction);
    fee += built.summary.fees;
    inputCount += chunk.length;
  }

  return {
    transactions,
    fee,
    inputCount,
    outputCount: transactions.length,
  };
}
