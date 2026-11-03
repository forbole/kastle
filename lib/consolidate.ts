import {
  createTransactions,
  IGeneratorSettingsObject,
  IUtxoEntry,
  PendingTransaction,
  RpcClient,
} from "@/wasm/core/kaspa";
import { orderEntries } from "@/lib/sendFee";
import { isFragmentationError } from "@/lib/kaspa";
import { signAndSubmitBatch } from "@/lib/wallet/transaction-batch";
import type { IWalletWithGetAddress } from "@/lib/wallet/wallet-interface";

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

// 0.1 KAS. A send's fee scales with its input count: the Generator charged
// 0.199 KAS for 174 inputs (MAX_SEND_RESERVE_KAS), so 0.1 KAS is a send that
// already spends ~80 inputs, one full consolidation chunk. Above it the user
// pays a sweep's worth of fee on every send; one round pays it once.
export const OPTIMIZE_FEE_THRESHOLD_SOMPI = 10_000_000n;

/**
 * Whether the send screen offers Optimize funds. A fragmentation error (the
 * Generator could not build the send) is offered to every wallet. A high fee
 * alone is not offered to Ledger: the send still works, and the round costs one
 * device approval per transaction.
 */
export function shouldOfferOptimize({
  planError,
  feeSompi,
  walletType,
}: {
  planError: unknown;
  feeSompi: bigint;
  walletType: string | undefined;
}): boolean {
  if (planError) return isFragmentationError(planError);
  return walletType !== "ledger" && feeSompi >= OPTIMIZE_FEE_THRESHOLD_SOMPI;
}

export type ConsolidationProgress = {
  submitted: number;
  // node rejected the signed transaction (for example a double spend of an
  // input still in the mempool): skipped, the round continues
  rejected: number;
  feePaid: bigint;
  // outpoints of the submitted transactions' inputs: a retry drops them, the
  // UTXO index lists them until the node accepts the spend
  spentOutpoints: string[];
};

export type ConsolidationResult = ConsolidationProgress & {
  // the round stopped on Cancel with transactions left to sign
  cancelled: boolean;
};

export type ConsolidationOutcome = "success" | "incomplete" | "cancelled-early";

/**
 * What the user is told once the round ends. "Funds Optimized" only when at
 * least one transaction landed, none was rejected and the round ran to the end;
 * a cancel before anything was submitted paid nothing and is not a failure.
 */
export function classifyConsolidation({
  submitted,
  rejected,
  cancelled,
  failed,
}: {
  submitted: number;
  rejected: number;
  cancelled: boolean;
  // a signing failure stopped the round
  failed: boolean;
}): ConsolidationOutcome {
  if (submitted > 0 && rejected === 0 && !cancelled && !failed) {
    return "success";
  }
  if (submitted === 0 && cancelled && !failed) return "cancelled-early";
  return "incomplete";
}

export const outpointKey = (outpoint: {
  transactionId: string;
  index: number;
}) => `${outpoint.transactionId}:${outpoint.index}`;

/**
 * The entries a round may spend: revalidated from the node, never the cached
 * set, minus the inputs a previous round already submitted.
 */
export async function loadLiveEntries(
  revalidate: () => Promise<IUtxoEntry[] | undefined>,
  spentOutpoints: readonly string[] = [],
): Promise<IUtxoEntry[]> {
  const spent = new Set(spentOutpoints);
  return ((await revalidate()) ?? []).filter(
    (entry) => !spent.has(outpointKey(entry.outpoint)),
  );
}

/**
 * Signs and submits each planned transaction on its own, stopping early when
 * `isCanceled` turns true. A signing failure (locked keyring, Ledger
 * rejection) throws; a submit rejection increments `rejected` and continues,
 * since the chunks are disjoint and the next one does not depend on it.
 */
export async function runConsolidation(
  transactions: readonly PendingTransaction[],
  signer: Pick<IWalletWithGetAddress, "signTx">,
  rpcClient: Pick<RpcClient, "submitTransaction">,
  {
    isCanceled = () => false,
    onTransaction,
  }: {
    isCanceled?: () => boolean;
    onTransaction?: (progress: ConsolidationProgress) => void;
  } = {},
): Promise<ConsolidationResult> {
  const progress: ConsolidationProgress = {
    submitted: 0,
    rejected: 0,
    feePaid: 0n,
    spentOutpoints: [],
  };
  let cancelled = false;
  for (const pending of transactions) {
    if (isCanceled()) {
      cancelled = true;
      break;
    }
    let signed = false;
    const markSigned: Pick<IWalletWithGetAddress, "signTx"> = {
      signTx: async (transaction) => {
        const signedTransaction = await signer.signTx(transaction);
        signed = true;
        return signedTransaction;
      },
    };
    try {
      await signAndSubmitBatch([pending], markSigned, rpcClient);
      progress.submitted++;
      progress.feePaid += pending.feeAmount;
      progress.spentOutpoints = [
        ...progress.spentOutpoints,
        ...pending.transaction.inputs.map((input) =>
          outpointKey(input.previousOutpoint),
        ),
      ];
    } catch (error) {
      if (!signed) throw error;
      progress.rejected++;
    }
    onTransaction?.({ ...progress });
  }
  return { ...progress, cancelled };
}

/** Focuses the Optimize funds tab when one is open, otherwise opens it. */
export async function openOptimizeFundsPage() {
  const url = new URL(browser.runtime.getURL("/popup.html"));
  const tabs = await browser.tabs.query({ url: url.toString() });
  url.hash = "/optimize-funds";
  const open = tabs.find((tab) => tab.url === url.toString());
  if (open?.id !== undefined) {
    await browser.tabs.update(open.id, { active: true });
    await browser.windows.update(open.windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url: url.toString() });
}
