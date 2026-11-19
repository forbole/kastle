// The page's lib/consolidate, unchanged, with a record of what it did: the
// outcome of the planning-time ownership guard (runConsolidation's own check
// is internal to the module and shows in `rounds`), every plan, every round.
// Local exports shadow the star export.
import * as real from "../../lib/consolidate";
import { getState } from "./stubs";

export * from "../../lib/consolidate";

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : String(error);
const key = (o: { transactionId: string; index: number }) =>
  `${o.transactionId}:${o.index}`;

export const assertSignerOwnsAddress: typeof real.assertSignerOwnsAddress =
  async (...args) => {
    try {
      await real.assertSignerOwnsAddress(...args);
      getState().guards.push("ok");
    } catch (error) {
      getState().guards.push(errorName(error));
      throw error;
    }
  };

export const planConsolidationRound: typeof real.planConsolidationRound =
  async (args) => {
    const result = await real.planConsolidationRound(args);
    const { entries } = args;
    const amounts = new Map(
      entries.map((e) => [key(e.outpoint), BigInt(e.amount)]),
    );
    const count = (pick: (e: (typeof entries)[number]) => boolean) =>
      entries.filter(pick).length;
    const entriesByAddress: Record<string, number> = {};
    for (const e of entries) {
      const address = String(e.address);
      entriesByAddress[address] = (entriesByAddress[address] ?? 0) + 1;
    }
    const { plan } = result;
    const chunks = plan?.transactions.map((t) => {
      const inputs = t.transaction.inputs.map((i) => key(i.previousOutpoint));
      return {
        id: t.id,
        fee: t.feeAmount.toString(),
        inputSompi: inputs
          .reduce((sum, i) => sum + amounts.get(i)!, 0n)
          .toString(),
        inputs,
      };
    });
    const planned = new Set(chunks?.flatMap((c) => c.inputs));
    const virtualDaaScore =
      args.rpcClient &&
      BigInt((await args.rpcClient.getBlockDagInfo()).virtualDaaScore);
    getState().plans.push({
      entries: entries.length,
      entriesByAddress,
      smallEntries: count((e) => BigInt(e.amount) < 100_000_000n),
      coinbaseEntries: count((e) => e.isCoinbase),
      screen: { ...result.screen },
      plan: plan && {
        fee: plan.fee.toString(),
        inputCount: plan.inputCount,
        skipped: plan.skipped,
        skippedCovenant: plan.skippedCovenant,
        skippedImmature: plan.skippedImmature,
        leftOut: entries
          .filter(
            (e) =>
              real.isConsolidatableEntry(
                e,
                args.changeAddress,
                virtualDaaScore,
              ) && !planned.has(key(e.outpoint)),
          )
          .map((e) => key(e.outpoint)),
        chunks: chunks!,
      },
    });
    return result;
  };

export const runConsolidation: typeof real.runConsolidation = async (
  ...args
) => {
  try {
    const result = await real.runConsolidation(...args);
    getState().rounds.push({
      submitted: result.submitted,
      rejected: result.rejected,
      feePaid: result.feePaid.toString(),
    });
    return result;
  } catch (error) {
    getState().rounds.push({ error: errorName(error) });
    throw error;
  }
};
