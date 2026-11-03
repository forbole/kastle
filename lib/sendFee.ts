import {
  createTransactions,
  IUtxoEntry,
  PendingTransaction,
} from "@/wasm/core/kaspa";
import { MAX_SEND_CHANGE_MARGIN_KAS, MAX_SEND_RESERVE_KAS } from "@/lib/kaspa";

// Plain arithmetic, not kaspaToSompi: this module loads before the WASM init.
const CHANGE_MARGIN = BigInt(Math.round(MAX_SEND_CHANGE_MARGIN_KAS * 1e8));
const MAX_SEND_RESERVE = BigInt(Math.round(MAX_SEND_RESERVE_KAS * 1e8));
// Upper bound on what the Generator charges per input once a send has to be
// batched: 13,084,164 sompi for 11,449 inputs is ~114,300 each.
const FEE_PER_INPUT_GUESS = 130_000n;
const MAX_PLAN_ROUNDS = 6;
const MAX_MASS_APPENDS = 3;
const MAX_FIXED_POINT_ROUNDS = 8;

type Entry = IUtxoEntry;

export type TransferPlan = {
  selected: Entry[];
  // summary.fees: every transaction of the batch, not just the payment
  fee: bigint;
  // the payment (last) transaction's own fee, the priority fee included
  paymentFee: bigint;
  // paymentFee less the priority fee: what the priority multiplier scales on,
  // so the fee it sets never feeds back into its own base
  paymentFeeBase: bigint;
  transactionCount: number;
  transactions: PendingTransaction[];
};

export type TransferShortfall = {
  insufficient: true;
  reason: "amount" | "margin";
};

export const isShortfall = (
  result: TransferPlan | TransferShortfall,
): result is TransferShortfall => "insufficient" in result;

const sum = (entries: readonly Entry[]) =>
  entries.reduce((total, entry) => total + entry.amount, 0n);

/**
 * The Generator does not sort: it spends `entries` in list order and takes the
 * first prefix covering amount + priorityFee. On a wallet of thousands of
 * equal small UTXOs that prefix leaves a dust change output whose KIP-9
 * storage mass exceeds 100,000, so the build throws ("Storage mass exceeds
 * maximum" for a 2 KAS send over 11,449 × 2.06 KAS). Largest first keeps the
 * change large, and the tie-break keeps the order deterministic.
 */
export function orderEntries<T extends Entry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
    const txA = a.outpoint.transactionId;
    const txB = b.outpoint.transactionId;
    if (txA !== txB) return txA < txB ? -1 : 1;
    return a.outpoint.index - b.outpoint.index;
  });
}

const isMassError = (error: unknown) =>
  /Mass calculation error|Storage mass exceeds maximum/.test(String(error));

const isInsufficientError = (error: unknown) =>
  /Insufficient funds/.test(String(error));

// Shortest prefix of `ordered` summing to at least `target`, or undefined.
const prefixLength = (ordered: readonly Entry[], target: bigint) => {
  let total = 0n;
  for (const [index, entry] of ordered.entries()) {
    total += entry.amount;
    if (total >= target) return index + 1;
  }
  return undefined;
};

// Shortest prefix of `ordered` whose surplus over `need` and the per-input fee
// guess, recomputed as the prefix grows, clears `margin`; the whole set if
// none does.
const grownLength = (
  ordered: readonly Entry[],
  need: bigint,
  margin: bigint,
) => {
  let total = 0n;
  for (const [index, entry] of ordered.entries()) {
    total += entry.amount;
    const feeGuess = BigInt(index + 1) * FEE_PER_INPUT_GUESS;
    if (total - need - feeGuess >= margin) return index + 1;
  }
  return ordered.length;
};

/**
 * Selects the UTXOs for a transfer in the app instead of handing the Generator
 * the whole set: the largest entries, grown until the change left after the
 * amount, priority fee and a per-input fee guess clears the storage mass margin.
 *
 * The Generator spends only the first prefix of its list that covers the
 * amount, so on equal-sized UTXOs a grown selection still leaves dust change
 * (2 KAS over [2.0604, 2.0604, …] spends one input, whatever it is handed).
 * On that mass error the surplus is split off into an explicit output to the
 * change address, sized so the Generator must spend the whole selection and
 * its own change stays near 2 × margin: payment, self output, change.
 *
 * Returns the built batch, so the caller signs exactly what was priced.
 */
export async function planTransfer({
  entries,
  amountSompi,
  outputAddress,
  changeAddress,
  priorityFee,
  networkId,
}: {
  entries: readonly Entry[];
  amountSompi: bigint;
  outputAddress: string;
  changeAddress: string;
  priorityFee: bigint;
  networkId: string;
}): Promise<TransferPlan | TransferShortfall> {
  const ordered = orderEntries(entries);
  if (sum(ordered) < amountSompi + priorityFee + CHANGE_MARGIN) {
    return { insufficient: true, reason: "amount" };
  }

  const need = amountSompi + priorityFee;
  let count = grownLength(ordered, need, CHANGE_MARGIN);
  let split = false;
  let smallestFirst = false;
  let massAppends = 0;
  let lastError: unknown;

  for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
    // The split needs a self output and the Generator's change, both past
    // the margin: 3 × margin of surplus.
    if (split)
      count = Math.max(count, grownLength(ordered, need, 3n * CHANGE_MARGIN));
    const prefix = ordered.slice(0, count);
    // Second resort: leading with the smallest selected entry moves where the
    // Generator's prefix ends when entry sizes differ ([3.00, 4.12, 4.12]).
    const selected =
      smallestFirst && prefix.length > 1
        ? [prefix[prefix.length - 1], ...prefix.slice(0, -1)]
        : prefix;
    const outputs = [{ address: outputAddress, amount: amountSompi }];
    if (split) {
      const feeGuess = BigInt(count) * FEE_PER_INPUT_GUESS;
      const selfAmount = sum(selected) - need - feeGuess - 2n * CHANGE_MARGIN;
      if (selfAmount >= CHANGE_MARGIN) {
        outputs.push({ address: changeAddress, amount: selfAmount });
      }
    }
    try {
      const { transactions, summary } = await createTransactions({
        entries: selected,
        outputs,
        priorityFee,
        changeAddress,
        networkId,
      });
      const change = sum(selected) - amountSompi - summary.fees;
      if (change < CHANGE_MARGIN) {
        if (count === ordered.length) {
          return { insufficient: true, reason: "margin" };
        }
        count = Math.max(
          count + 1,
          prefixLength(ordered, amountSompi + summary.fees + CHANGE_MARGIN) ??
            ordered.length,
        );
        continue;
      }
      // The change clears the margin, so the prefix already covers the fee
      // charged: the fee would not change on another round.
      const paymentFee = transactions[transactions.length - 1].feeAmount;
      return {
        selected,
        fee: summary.fees,
        paymentFee,
        paymentFeeBase: paymentFee - priorityFee,
        transactionCount: transactions.length,
        transactions,
      };
    } catch (error) {
      lastError = error;
      // WASM throws bare strings, so match on String(error).
      const massError = isMassError(error);
      if (!massError && !isInsufficientError(error)) throw error;
      if (massError) {
        if (massAppends++ >= MAX_MASS_APPENDS) throw error;
        if (!split) {
          split = true;
        } else {
          if (count === ordered.length) throw error;
          smallestFirst = true;
          count += 1;
        }
      } else {
        if (count === ordered.length) {
          return { insufficient: true, reason: "margin" };
        }
        // "Insufficient funds": the fee guess fell short; one more input.
        count += 1;
      }
    }
  }
  throw lastError ?? new Error("planTransfer: no plan within the round limit");
}

export type MaxSendable = {
  amountSompi: bigint;
  fee: bigint;
  transactionCount: number;
  // createTransactions calls made, for tests
  builds: number;
};

/**
 * The largest amount the Generator builds when spending every UTXO, priced
 * against the batch's real fee (summary.fees) rather than a one-input probe.
 *
 * Fixed point of a = B − fee(a) − M. It terminates because the fee is a
 * non-decreasing step function of the amount over a fixed input set (more
 * amount never needs fewer transactions or less mass): from a built amount,
 * the next guess either repeats it (done) or moves to the far edge of the
 * current fee step, and a throw after a success only ever steps down by M
 * from the largest amount that built. The loop is bounded anyway.
 */
export async function findMaxSendable({
  entries,
  priorityFee,
  changeAddress,
  networkId,
}: {
  entries: readonly Entry[];
  priorityFee: bigint;
  changeAddress: string;
  networkId: string;
}): Promise<MaxSendable | undefined> {
  if (!entries.length) return undefined;
  const ordered = orderEntries(entries);
  const balance = sum(ordered);
  let reserve = MAX_SEND_RESERVE + priorityFee;
  const perInputReserve =
    BigInt(ordered.length) * FEE_PER_INPUT_GUESS + priorityFee + CHANGE_MARGIN;
  if (perInputReserve > reserve) reserve = perInputReserve;

  let amount = balance - reserve;
  let best: MaxSendable | undefined;
  let builds = 0;

  for (let round = 0; round < MAX_FIXED_POINT_ROUNDS && amount > 0n; round++) {
    try {
      builds++;
      const { transactions, summary } = await createTransactions({
        entries: ordered,
        outputs: [{ address: changeAddress, amount }],
        priorityFee,
        changeAddress,
        networkId,
      });
      const next = balance - summary.fees - CHANGE_MARGIN;
      // Only an amount that leaves the margin counts: planTransfer, which the
      // send itself runs, rejects anything less.
      if (next >= amount && (!best || amount > best.amountSompi)) {
        best = {
          amountSompi: amount,
          fee: summary.fees,
          transactionCount: transactions.length,
          builds,
        };
      }
      if (next === amount) break;
      if (best && next <= best.amountSompi) break;
      amount = next;
    } catch (error) {
      if (!isMassError(error) && !isInsufficientError(error)) throw error;
      if (!best) {
        reserve *= 2n;
        amount = balance - reserve;
      } else {
        amount -= CHANGE_MARGIN;
        if (amount <= best.amountSompi) break;
      }
    }
  }

  return best && { ...best, builds };
}
