import { test, expect } from "@playwright/test";
import type { TransactionPlan } from "@kasparocket/sdk";
import * as signer from "@/lib/kasparocket/signer";
import {
  REAL_BUDGET_SOMPI,
  REAL_LP_COVENANT_ID,
  REAL_NETWORK_FEE_SOMPI,
  REAL_TOKEN_ID,
  REAL_XONLY_PK,
  realPlan,
  realProtocol,
  realQuote,
} from "./fixtures/kasparocket-real-buy";

// What the signer takes on the server's word, on the real FOUR buy
// (fixtures/kasparocket-real-buy.ts): B the fee outputs. Nothing is signed: the signDigest below throws
// REACHED. A plan whose transaction was edited cannot reach it (its prepared
// sighashes no longer match), so "refused at the sighash check" is how such a
// plan shows it cleared every check before it. No network, no broadcast.
// (`import * as`: the file still loads against the pre-fix signer.)

const { KaspaRocketSignRefusal, kastleKaspaRocketSigner } = signer;
type KaspaRocketGuard = signer.KaspaRocketGuard;

const NOW = 1_000_000;
const REACHED = "reached the key: every pre-sign check passed";
const PAYEE = /plan pays an address this wallet cannot spend/;
const KAS = 100_000_000n;
// Real plan outputs: 0 partner fee (the wallet's own key), 1 wallet change,
// 2 pool vault, 3 token reserve cell, 4 bought-token cell, 5 treasury fee.
const CHANGE = 1;

async function guardOf(
  over: Partial<KaspaRocketGuard> = {},
): Promise<KaspaRocketGuard> {
  return {
    quote: await realQuote(),
    trade: {
      tokenId: REAL_TOKEN_ID,
      direction: "buy",
      amountIn: REAL_BUDGET_SOMPI,
    },
    lpCovenantId: REAL_LP_COVENANT_ID,
    slippageBps: 100n,
    builtAt: NOW,
    now: () => NOW,
    protocol: async () => realProtocol(),
    ...over,
  };
}

async function run(plan: TransactionPlan, guard?: KaspaRocketGuard) {
  const calls: [number, number][] = [];
  const result = kastleKaspaRocketSigner(
    async (t, i) => {
      calls.push([t, i]);
      throw new Error(REACHED);
    },
    REAL_XONLY_PK,
    guard ?? (await guardOf()),
  ).signPlan(plan);
  return { result, calls };
}

async function expectReached(plan: TransactionPlan, guard?: KaspaRocketGuard) {
  const { result, calls } = await run(plan, guard);
  await expect(result).rejects.toThrow(REACHED);
  expect(calls).toEqual([[0, 2]]);
}

async function expectRefused(
  plan: TransactionPlan,
  message: RegExp,
  guard?: KaspaRocketGuard,
) {
  const { result, calls } = await run(plan, guard);
  await expect(result).rejects.toThrow(KaspaRocketSignRefusal);
  await expect(result).rejects.toThrow(message);
  expect(calls).toEqual([]);
}

const outsOf = (raw: any) => raw.transactions[0].tx.outputs;
/** Moves `sompi` of wallet change into output `to`: network fee unchanged. */
const moveChange = (raw: any, to: number, sompi: bigint) => {
  const o = outsOf(raw);
  o[CHANGE].value = String(BigInt(o[CHANGE].value) - sompi);
  o[to].value = String(BigInt(o[to].value) + sompi);
};
const payees = (
  plan: TransactionPlan,
  {
    amountIn = REAL_BUDGET_SOMPI,
    protocol = realProtocol(),
    pk = REAL_XONLY_PK,
  } = {},
) =>
  signer.kaspaRocketCheckPayees(
    plan,
    {
      trade: { tokenId: REAL_TOKEN_ID, direction: "buy", amountIn },
      lpCovenantId: REAL_LP_COVENANT_ID,
    } as unknown as KaspaRocketGuard,
    pk,
    protocol,
  );

test.describe("B. fee outputs are bounded by protocol()'s schedule, not the summary", () => {
  test("★ 100 KAS of change into the treasury output, summary raised to match, refuses", async () => {
    const plan = realPlan((raw) => {
      moveChange(raw, 5, 100n * KAS);
      raw.summary.platformFeeSompi = 102n * KAS;
      // The fee line keeps showing the honest 3 KAS.
      expect(raw.summary.totalPlatformFeeSompi).toBe(300_000_000);
    });
    // The payee list on its own refuses it (C alone would too, see below).
    expect(() => payees(plan)).toThrow(PAYEE);
    await expectRefused(plan, PAYEE);
  });

  test("★ the treasury cap is the schedule's for this trade: 2 KAS on 160 KAS, 10 KAS on 1000", () => {
    // Real plan: 2 KAS treasury, the schedule's floor on a 160 KAS budget.
    expect(() => payees(realPlan())).not.toThrow();
    // One sompi over the floor, summary matched, refuses.
    const over = realPlan((raw) => {
      moveChange(raw, 5, 1n);
      raw.summary.platformFeeSompi = 2n * KAS + 1n;
    });
    expect(() => payees(over)).toThrow(PAYEE);
    // A 10 KAS treasury output is what 1% of a 1000 KAS trade charges.
    const ten = realPlan((raw) => {
      moveChange(raw, 5, 8n * KAS);
      raw.summary.platformFeeSompi = 10n * KAS;
    });
    expect(() => payees(ten, { amountIn: 1000n * KAS })).not.toThrow();
    expect(() => payees(ten, { amountIn: 999n * KAS })).toThrow(PAYEE);
  });

  test("★ the partner cap is the schedule's partner cut: 1 KAS on 160 KAS", () => {
    const OTHER = "cd".repeat(32);
    // As in the plan-shape spec: the wallet is the real plan's partner, so
    // move its change to another wallet and output 0 is judged as a fee.
    const asOther = (edit?: (raw: any) => void) =>
      realPlan((raw) => {
        outsOf(raw)[CHANGE].scriptPublicKey = {
          version: 0,
          script: `20${OTHER}ac`,
        };
        edit?.(raw);
      });
    expect(() => payees(asOther(), { pk: OTHER })).not.toThrow();
    const over = asOther((raw) => {
      moveChange(raw, 0, 1n);
      raw.summary.partnerFeeSompi = KAS + 1n;
    });
    expect(() => payees(over, { pk: OTHER })).toThrow(PAYEE);
  });

  test("the summary stays the second, stricter bound", () => {
    // Under the schedule's cap, but not what the summary states.
    const under = realPlan((raw) => moveChange(raw, 5, -1n));
    expect(() => payees(under)).toThrow(PAYEE);
  });

  test("★ an unreadable schedule refuses, never falls back to the summary", () => {
    for (const edit of [
      (p: any) => delete p.fees,
      (p: any) => (p.fees.treasuryRate = "0.01"),
      (p: any) => delete p.fees.partnerMinSompi,
    ]) {
      expect(() =>
        payees(realPlan(), { protocol: realProtocol(edit) }),
      ).toThrow(/fee schedule cannot be read/);
    }
  });
});

test("★ the real plan, whole: every check passes and the key is reached", async () => {
  expect(String(REAL_NETWORK_FEE_SOMPI)).toBe("18658300");
  await expectReached(realPlan());
});
