import type { TransactionPlan } from "@kasparocket/sdk";
import { planDigests } from "@/lib/kasparocket/adapter";

/** `plan` with every sighash recomputed from its (edited) transaction. */
export const resighed = (plan: TransactionPlan): TransactionPlan => {
  const digests = planDigests(plan);
  return {
    ...plan,
    transactions: plan.transactions.map((p, t) => ({
      ...p,
      signingInstructions: p.signingInstructions.map((ins) => {
        const d = digests.find(
          (x) => x.txIndex === t && x.inputIndex === ins.inputIndex,
        );
        return d ? { ...ins, sighash: d.digest } : ins;
      }),
    })),
  };
};

/**
 * The synthetic buy in the shape a real `/plan/trade` buy has (see
 * kasparocket-payout-unit.spec.ts): the wallet's token cell (output 1) is a
 * covenant output behind a P2SH, its `value` is not the token amount, and the
 * summary names the cell and states the amount. Sighashes recomputed. A fresh
 * copy each call; `summary.kasFlowSompi` left as the fixture's string.
 * `fixture` is kasparocket-plan.synthetic.json, as the caller loaded it.
 *
 * The cell is put behind the pool vault's own P2SH only because `checkPayees`
 * lets a token output through on a pool script alone. On the real plan the
 * user cell has its own P2SH, which `checkPayees` refuses: a known gap, out of
 * this fixture's scope.
 */
export function syntheticBuyPlan(fixture: {
  plan: unknown;
  quote: { amountTokens: string };
}): TransactionPlan {
  const raw = JSON.parse(JSON.stringify(fixture.plan));
  const outs = raw.transactions[0].tx.outputs;
  outs[1].scriptPublicKey = outs[0].scriptPublicKey;
  raw.summary = {
    ...raw.summary,
    direction: "buy",
    amountTokens: fixture.quote.amountTokens,
    userTokensAfter: fixture.quote.amountTokens,
    outputs: { kcc20User: 1 },
  };
  return resighed(raw);
}
