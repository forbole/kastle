import { blake2b256 } from "@dotk/sdk";
import type { TransactionPlan } from "@kasparocket/sdk";
import { bytesToHex, hexToBytes } from "viem";
import { planDigests } from "@/lib/kasparocket/adapter";
import { pushMinimal } from "@/lib/kcc20/standard/primitives";
import { splitProgram, successorProgram } from "@/lib/kcc20/standard/program";
import { BORROW_SCHEME, OWNER_SCHEME } from "@/lib/kcc20/standard/state";
import { REAL_LEADER_PROGRAM } from "./kasparocket-real-leader";

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
 * The cell is bound as on the real plan: a token leader input (input 2,
 * named by `summary.inputs.kcc20Leader`) spends the real FOUR program, and
 * the cell's own P2SH is that program's successor for `amountTokens` owned by
 * the fixture's key, so the signer's payout read accepts it. It passes
 * `checkPayees` on its `summary.outputs.kcc20User` index, as on the real plan
 * (kasparocket-plan-shape-unit.spec.ts).
 */
export function syntheticBuyPlan(fixture: {
  plan: unknown;
  quote: { amountTokens: string };
  tokenId: string;
  xOnlyPk: string;
}): TransactionPlan {
  const raw = unboundRaw(fixture);
  const tx = raw.transactions[0].tx;
  // The token's leader cell, appended as input 2: the real FOUR program (the
  // allowlisted 11458-byte template) behind its own P2SH, under the synthetic
  // token's covenant id. Its value moves to the user cell, so the network
  // fee is unchanged.
  const program = REAL_LEADER_PROGRAM;
  const p2sh = (r: Uint8Array) => `aa20${hex(blake2b256(r))}87`;
  const LEADER_VALUE = 50_000_000n;
  tx.inputs.push({
    transactionId: "03".repeat(32),
    index: 0,
    sequence: "0",
    sigOpCount: 0,
    computeBudget: 10,
    signatureScript: hex(pushMinimal(program)),
    utxo: {
      address: null,
      amount: String(LEADER_VALUE),
      scriptPublicKey: `0000${p2sh(program)}`,
      blockDaaScore: "9000003",
      isCoinbase: false,
      covenantId: fixture.tokenId,
    },
  });
  // The user cell: the successor a cell of `amountTokens` owned by the
  // wallet's key hashes to, as the wallet's own transfer builder writes it.
  const cell = tx.outputs[1];
  cell.value = String(BigInt(cell.value) + LEADER_VALUE);
  cell.covenant = { authorizingInput: 2, covenantId: fixture.tokenId };
  cell.scriptPublicKey = `0000${p2sh(
    successorProgram(program, {
      amount: BigInt(fixture.quote.amountTokens),
      owner: hexToBytes(`0x${fixture.xOnlyPk}`),
      ownerScheme: OWNER_SCHEME.P2PK_SCHNORR,
      borrowScheme: BORROW_SCHEME.DISABLED,
      borrowGuard: new Uint8Array(32),
      extensionCommitment: splitProgram(program).state.extensionCommitment,
    }),
  )}`;
  raw.summary.inputs = { kcc20Leader: 2 };
  return resighed(raw);
}

/**
 * The synthetic buy before its token cell was bound: the cell sits behind
 * the pool vault's own P2SH and no token program is spent, so nothing ties
 * the cell to `amountTokens`. The signer refuses it; kept to pin that.
 */
export function syntheticBuyPlanUnbound(fixture: {
  plan: unknown;
  quote: { amountTokens: string };
}): TransactionPlan {
  return resighed(unboundRaw(fixture));
}

function unboundRaw(fixture: {
  plan: unknown;
  quote: { amountTokens: string };
}) {
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
  return raw;
}

const hex = (b: Uint8Array) => bytesToHex(b).slice(2);
