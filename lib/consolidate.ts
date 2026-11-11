import {
  ConnectStrategy,
  createTransactions,
  IGeneratorSettingsObject,
  IUtxoEntry,
  payToAddressScript,
  PendingTransaction,
  RpcClient,
} from "@/wasm/core/kaspa";
import { covenantSelect } from "@kronsdk/kron-sdk";
import { orderEntries } from "@/lib/sendFee";
import { isFragmentationError } from "@/lib/kaspa";
import { redactString } from "@/lib/sentry-scrub";
import { signAndSubmitBatch } from "@/lib/wallet/transaction-batch";
import type { IWalletWithGetAddress } from "@/lib/wallet/wallet-interface";

// The Generator batches at 89 inputs of this shape; 80 leaves ~10% mass
// headroom so every chunk builds as a single transaction.
const DEFAULT_INPUTS_PER_TRANSACTION = 80;

// Ledger signs at most two outputs per transaction.
const MAX_OUTPUTS = 2;

// Kaspa coinbase outputs are spendable 100 DAA scores after their block.
export const COINBASE_MATURITY = 100n;

export type ConsolidationPlan = {
  transactions: PendingTransaction[];
  // summary.fees summed across every chunk
  fee: bigint;
  inputCount: number;
  outputCount: number;
  // entries left out of the round (covenant-bound, another key's script, or
  // an immature coinbase)
  skipped: number;
  // the virtual DAA score was unavailable: coinbase maturity went unchecked
  maturityUnknown: boolean;
};

/**
 * Whether the round may spend `entry`: plain KAS, locked to `address` itself
 * (the only script the wallet's key signs; any other input would go out with
 * an empty signature script), and not an immature coinbase. Maturity is
 * skipped when `virtualDaaScore` is unknown.
 */
export function isConsolidatableEntry(
  entry: IUtxoEntry,
  address: string,
  virtualDaaScore?: bigint,
): boolean {
  if (
    covenantSelect.normalizedCovenantId(
      (entry as { covenantId?: string }).covenantId,
    )
  ) {
    return false;
  }
  if (entry.scriptPublicKey?.script !== payToAddressScript(address).script) {
    return false;
  }
  if (entry.isCoinbase && virtualDaaScore !== undefined) {
    return virtualDaaScore - BigInt(entry.blockDaaScore) >= COINBASE_MATURITY;
  }
  return true;
}

async function readVirtualDaaScore(
  rpcClient?: Pick<RpcClient, "getBlockDagInfo">,
): Promise<bigint | undefined> {
  if (!rpcClient) return undefined;
  try {
    return BigInt((await rpcClient.getBlockDagInfo()).virtualDaaScore);
  } catch (error) {
    console.warn("getBlockDagInfo failed; coinbase maturity unchecked", error);
    return undefined;
  }
}

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
 * Only entries `isConsolidatableEntry` accepts for `changeAddress` are
 * planned; the rest are counted in `skipped`. Coinbase maturity reads the
 * virtual DAA score from `rpcClient` once; without it the plan still builds,
 * flagged `maturityUnknown`.
 *
 * Returns undefined when the spendable entries already fit in a single
 * transaction.
 */
export async function planConsolidation({
  entries,
  changeAddress,
  networkId,
  inputsPerTransaction = DEFAULT_INPUTS_PER_TRANSACTION,
  rpcClient,
}: {
  entries: readonly IUtxoEntry[];
  changeAddress: string;
  networkId: string;
  inputsPerTransaction?: number;
  rpcClient?: Pick<RpcClient, "getBlockDagInfo">;
}): Promise<ConsolidationPlan | undefined> {
  if (!entries.length) {
    throw new ConsolidationError("no-entries", "No UTXOs to consolidate");
  }
  const virtualDaaScore = await readVirtualDaaScore(rpcClient);
  const spendable = entries.filter((entry) =>
    isConsolidatableEntry(entry, changeAddress, virtualDaaScore),
  );
  if (spendable.length <= inputsPerTransaction) return undefined;

  const ordered = orderEntries(spendable);
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
    skipped: entries.length - spendable.length,
    maturityUnknown: virtualDaaScore === undefined,
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
  // the node's text for the last rejection, scrubbed and trimmed
  lastError?: string;
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

/** One line for a finished round, in transactions (never UTXO counts). */
export function describeRound({
  submitted,
  rejected,
  total,
  feePaid,
}: {
  submitted: number;
  rejected: number;
  total: number;
  feePaid: string;
}): string {
  const sent = `${submitted} of ${total} transactions sent`;
  if (submitted === 0) {
    // all-rejected is reachable only by a one-transaction plan (N+1 inputs);
    // anything bigger stops at the first rejection (runConsolidation)
    // no rejection: signing or the reconnect failed before anything went out
    const what =
      rejected === 0
        ? "stopped before sending"
        : rejected === total
          ? `all ${total} rejected`
          : "stopped after the first rejection";
    return `${sent} · ${what} · nothing paid`;
  }
  return `${sent} · ${rejected} rejected · fee paid ${feePaid} KAS`;
}

/** 64-hex runs (txids, keys) via the Sentry redactor, then addresses. */
export const scrubReportText = (text: string) =>
  redactString(text).replace(/kaspa(?:test|dev|sim)?:[a-z0-9]+/g, "[ADDRESS]");

/** Scrubbed, then cut: a cut 64-hex run would slip past the redactor. */
export const reportError = (error: unknown) =>
  scrubReportText(String(error)).slice(0, 300);

/**
 * What the failure screen's "Copy report" hands the user to send us: counts,
 * versions and the node's reason. No address, outpoint or txid: every string
 * field is scrubbed.
 */
export function buildRoundReport<
  T extends Record<string, string | number | undefined>,
>(fields: T): T & { timestamp: string } {
  return {
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === "string" ? scrubReportText(value) : value,
      ]),
    ),
    timestamp: new Date().toISOString(),
  } as T & { timestamp: string };
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
 * since the chunks are disjoint and the next one does not depend on it —
 * unless nothing has landed yet: a first rejection stops the round, since a
 * transaction-wide refusal would only repeat on every remaining chunk.
 */
export async function runConsolidation(
  transactions: readonly PendingTransaction[],
  signer: Pick<IWalletWithGetAddress, "signTx">,
  rpcClient: Pick<RpcClient, "submitTransaction"> &
    Partial<Pick<RpcClient, "isConnected" | "connect">>,
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
    // the context never hears a socket drop: ask the WASM client itself
    if (rpcClient.isConnected === false) {
      try {
        // Fallback: one attempt, returns at once; Retry would block forever
        await rpcClient.connect?.({ strategy: ConnectStrategy.Fallback });
      } catch (cause) {
        // the short sentence for the user; the node's reason rides as cause
        throw new Error(
          "the node connection dropped; nothing further was sent",
          { cause: scrubReportText(String(cause)) },
        );
      }
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
      progress.lastError = reportError(error);
      if (progress.submitted === 0) {
        onTransaction?.({ ...progress });
        break;
      }
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
