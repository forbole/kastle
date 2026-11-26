import { test, expect } from "@playwright/test";
import type { Quote, TransactionPlan } from "@kasparocket/sdk";
import * as signer from "@/lib/kasparocket/signer";
import * as confirm from "@/lib/kasparocket/confirm";
import {
  kaspaRocketFeesOf,
  kaspaRocketPlanNetworkFee,
} from "@/lib/kasparocket/fees";
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

// The pre-sign guard on the real FOUR buy (fixtures/kasparocket-real-buy.ts):
// the quote's sign, the network fee ceiling, the Max hold-back. Nothing is
// signed: the signDigest below throws REACHED, so a plan that gets that far
// has cleared every check the signer makes before asking for a signature.
// (`import * as`: the file still loads against the pre-fix modules.)

const { KaspaRocketSignRefusal, kastleKaspaRocketSigner } = signer;
type KaspaRocketGuard = signer.KaspaRocketGuard;

const NOW = 1_000_000;
const REACHED = "reached the key: every pre-sign check passed";
// 160 KAS of budget, protocol() fees: max(1%, 2 KAS) + max(0.5%, 1 KAS).
const REAL_FEE_SOMPI = 300_000_000n;

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

/** Runs signPlan; answers the first signature request it reached, or the refusal. */
async function run(plan: TransactionPlan, guard: KaspaRocketGuard) {
  const calls: [number, number][] = [];
  const result = kastleKaspaRocketSigner(
    async (t, i) => {
      calls.push([t, i]);
      throw new Error(REACHED);
    },
    REAL_XONLY_PK,
    guard,
  ).signPlan(plan);
  return { result, calls };
}

async function expectReached(plan: TransactionPlan, guard: KaspaRocketGuard) {
  const { result, calls } = await run(plan, guard);
  await expect(result).rejects.toThrow(REACHED);
  // The first p2pkh input of the real plan.
  expect(calls).toEqual([[0, 2]]);
}

async function expectRefused(
  plan: TransactionPlan,
  guard: KaspaRocketGuard,
  message: RegExp,
) {
  const { result, calls } = await run(plan, guard);
  await expect(result).rejects.toThrow(KaspaRocketSignRefusal);
  await expect(result).rejects.toThrow(message);
  expect(calls).toEqual([]);
}

const UNECONOMIC = /quote is uneconomic/;

test.describe("A. the quote's sign: a buy spends KAS", () => {
  test("the real quote, through the SDK's own quote(): a buy's net is the outflow, negative", async () => {
    const q = await realQuote();
    expect(String(q.netKasSompi)).toBe("-16299997202");
    expect(String(q.kasFlowSompi)).toBe("15999997202");
    expect(String(q.fee.total)).toBe(String(REAL_FEE_SOMPI));
    expect(q.uneconomic).toBe(false);
    // Outflow = into the pool + the fee: 2 798 sompi under budget + fee.
    expect(String(-q.netKasSompi)).toBe(String(q.kasFlowSompi + q.fee.total));
    expect(String(REAL_BUDGET_SOMPI + REAL_FEE_SOMPI + q.netKasSompi)).toBe(
      "2798",
    );
  });

  test("★ the real buy quote passes: the real plan reaches the key", async () => {
    await expectReached(realPlan(), await guardOf());
  });

  test("★ a buy whose outflow exceeds the budget (plus protocol()'s fee on it) refuses", async () => {
    const at = -(REAL_BUDGET_SOMPI + REAL_FEE_SOMPI);
    // At the bound it passes...
    await expectReached(
      realPlan(),
      await guardOf({ quote: { ...(await realQuote()), netKasSompi: at } }),
    );
    // ...one sompi over refuses, as does a quote for twice the budget.
    for (const net of [at - 1n, -2n * REAL_BUDGET_SOMPI]) {
      await expectRefused(
        realPlan(),
        await guardOf({ quote: { ...(await realQuote()), netKasSompi: net } }),
        UNECONOMIC,
      );
    }
    // The budget is the user's, not the quote's: the same quote against a
    // smaller entered budget refuses.
    await expectRefused(
      realPlan(),
      await guardOf({
        trade: {
          tokenId: REAL_TOKEN_ID,
          direction: "buy",
          amountIn: REAL_BUDGET_SOMPI - 1_000_000_000n,
        },
      }),
      UNECONOMIC,
    );
  });

  test("★ a buy the quote marks uneconomic refuses", async () => {
    await expectRefused(
      realPlan(),
      await guardOf({ quote: { ...(await realQuote()), uneconomic: true } }),
      UNECONOMIC,
    );
  });

  test("★ a sell whose KAS received is not positive still refuses", async () => {
    for (const net of [0n, -1n, -16_299_997_202n]) {
      await expectRefused(
        realPlan(),
        await guardOf({
          trade: {
            tokenId: REAL_TOKEN_ID,
            direction: "sell",
            amountIn: 1_000n,
          },
          quote: {
            ...(await realQuote()),
            direction: "sell",
            amountTokens: 1_000n,
            netKasSompi: net,
          } as Quote,
        }),
        UNECONOMIC,
      );
    }
  });

  test("fails closed: no KAS leaving on a buy, an unreadable net or flag, an unreadable fee schedule", async () => {
    const q = await realQuote();
    const quotes: Quote[] = [
      // 0n is also what the SDK reads a missing net_kas_sompi as.
      { ...q, netKasSompi: 0n },
      { ...q, netKasSompi: 1n },
      { ...q, netKasSompi: undefined as unknown as bigint },
      { ...q, netKasSompi: -16299997202 as unknown as bigint },
      { ...q, uneconomic: undefined as unknown as boolean },
    ];
    for (const quote of quotes)
      await expectRefused(realPlan(), await guardOf({ quote }), UNECONOMIC);
    for (const edit of [
      (p: any) => delete p.fees,
      (p: any) => (p.fees.treasuryRate = "0.01"),
      (p: any) => delete p.fees.partnerMinSompi,
    ]) {
      await expectRefused(
        realPlan(),
        await guardOf({ protocol: async () => realProtocol(edit) }),
        UNECONOMIC,
      );
    }
  });

  test("the hook and the signer share one rule", async () => {
    const q = await realQuote();
    const fees = kaspaRocketFeesOf(realProtocol());
    const buy = { direction: "buy" as const, amountIn: REAL_BUDGET_SOMPI };
    expect(signer.kaspaRocketQuoteUneconomic(q, buy, fees)).toBe(false);
    expect(signer.kaspaRocketQuoteUneconomic(q, buy, undefined)).toBe(true);
    expect(
      signer.kaspaRocketQuoteUneconomic(
        { ...q, netKasSompi: -(REAL_BUDGET_SOMPI + REAL_FEE_SOMPI) - 1n },
        buy,
        fees,
      ),
    ).toBe(true);
    const sell = { direction: "sell" as const, amountIn: 1_000n };
    expect(
      signer.kaspaRocketQuoteUneconomic({ ...q, netKasSompi: 1n }, sell, fees),
    ).toBe(false);
    expect(
      signer.kaspaRocketQuoteUneconomic({ ...q, netKasSompi: 0n }, sell, fees),
    ).toBe(true);
  });
});

test.describe("B. the network fee ceiling", () => {
  // Takes `sompi` off the wallet's change (output 1): the fee grows by it.
  const withFee = (fee: bigint) =>
    realPlan((raw) => {
      const change = raw.transactions[0].tx.outputs[1];
      change.value = String(
        BigInt(change.value) - (fee - REAL_NETWORK_FEE_SOMPI),
      );
    });

  test("★ the real plan's 0.187 KAS network fee passes", async () => {
    expect(String(kaspaRocketPlanNetworkFee(realPlan()))).toBe("18658300");
    await expectReached(realPlan(), await guardOf());
  });

  test("★ 0.31 KAS refuses; the ceiling itself passes", async () => {
    expect(String(signer.KASPAROCKET_NETWORK_FEE_CEILING_SOMPI)).toBe(
      "30000000",
    );
    const over = withFee(31_000_000n);
    expect(String(kaspaRocketPlanNetworkFee(over))).toBe("31000000");
    await expectRefused(
      over,
      await guardOf(),
      /network fee 31000000 sompi is over the 30000000 sompi ceiling/,
    );
    await expectRefused(
      withFee(30_000_001n),
      await guardOf(),
      /network fee 30000001 sompi is over the 30000000 sompi ceiling/,
    );
    // At the ceiling the fee check passes; the edited change then fails the
    // sighash check, the next one, which proves the fee check let it by.
    await expectRefused(
      withFee(30_000_000n),
      await guardOf(),
      /input 2 sighash does not match the prepared one/,
    );
  });

  test("★ the swap screen's Max holds back exactly the ceiling constant", () => {
    const ceiling = signer.KASPAROCKET_NETWORK_FEE_CEILING_SOMPI;
    const balance = 6_500_000_000_000n;
    expect(String(confirm.kaspaRocketMaxIn("buy", balance))).toBe(
      String(balance - ceiling),
    );
    expect(String(balance - confirm.kaspaRocketMaxIn("buy", balance))).toBe(
      "30000000",
    );
    // A sell spends tokens, not KAS: nothing held back.
    expect(String(confirm.kaspaRocketMaxIn("sell", balance))).toBe(
      String(balance),
    );
    // Never below zero.
    expect(String(confirm.kaspaRocketMaxIn("buy", ceiling - 1n))).toBe("0");
  });
});
