import { test, expect } from "@playwright/test";
import { blake2b256 } from "@dotk/sdk";
import { schnorr } from "@noble/curves/secp256k1";
import type { Quote, TransactionPlan } from "@kasparocket/sdk";
import { bytesToHex, hexToBytes } from "viem";
import { planDigests } from "@/lib/kasparocket/adapter";
import * as signer from "@/lib/kasparocket/signer";
import * as confirm from "@/lib/kasparocket/confirm";
import {
  kaspaRocketFeesOf,
  kaspaRocketPlanNetworkFee,
} from "@/lib/kasparocket/fees";
import { splitProgram, successorProgram } from "@/lib/kcc20/standard/program";
import { BORROW_SCHEME, OWNER_SCHEME } from "@/lib/kcc20/standard/state";
import {
  REAL_BUDGET_SOMPI,
  REAL_LEADER_PROGRAM,
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

test.describe("C. the wallet's debit is bounded on each transaction, not only on the plan", () => {
  // Each transaction is signed on its own: the server may broadcast one and
  // never the other, so a credit in one cannot pay for an overcharge in
  // another. Real plan outputs: 0 partner fee (the wallet's own key),
  // 1 wallet change, 2 pool vault, 3 token reserve, 4 bought cell, 5 treasury.
  const KAS = 100_000_000n;
  const MOST = "16530000000";
  const tx0 = (raw: any) => raw.transactions[0].tx;
  /** Moves `sompi` of change into the pool vault: tx 0 debits that much more. */
  const overcharge = (raw: any, sompi: bigint) => {
    const o = tx0(raw).outputs;
    o[1].value = String(BigInt(o[1].value) - sompi);
    o[2].value = String(BigInt(o[2].value) + sompi);
  };
  /**
   * Appends a second transaction spending input `from` of tx 0's shape into
   * output `to`'s shape, at `from`'s amount: no network fee of its own.
   */
  const addTx = (raw: any, from: number, to: number) => {
    const t = JSON.parse(JSON.stringify(tx0(raw)));
    const input = t.inputs[from];
    input.previousOutpoint.transactionId = "ab".repeat(32);
    input.utxo.outpoint.transactionId = "ab".repeat(32);
    input.signatureScript = "";
    const output = { ...t.outputs[to], value: input.utxo.amount };
    raw.transactions.push({
      tx: { ...t, inputs: [input], outputs: [output] },
      signingInstructions: [],
    });
  };
  const debits = (plan: TransactionPlan) =>
    signer.kaspaRocketWalletDebits(plan, REAL_XONLY_PK)?.map(String);
  const total = (plan: TransactionPlan) =>
    String(signer.kaspaRocketWalletDebit(plan, REAL_XONLY_PK));

  test("★ an overcharging tx 0 offset by a tx 1 that credits the wallet refuses, naming tx 0", async () => {
    // tx 0 takes 2 KAS more than the buy allows; tx 1 pays the pool vault
    // input's 2 KAS to the wallet's own key.
    const plan = realPlan((raw) => {
      overcharge(raw, 2n * KAS);
      addTx(raw, 0, 1);
    });
    expect(debits(plan)).toEqual(["16618655502", "-200000000"]);
    // Summed, the plan sits inside the limit: the old check let it by.
    expect(total(plan)).toBe("16418655502");
    expect(16418655502n <= BigInt(MOST)).toBe(true);
    // Every other bound holds: one network fee, the real payout.
    expect(String(kaspaRocketPlanNetworkFee(plan))).toBe("18658300");
    expect(
      String(
        signer.kaspaRocketPlanPayout(plan, REAL_TOKEN_ID, REAL_XONLY_PK, "buy"),
      ),
    ).toBe("5298975");
    await expectRefused(
      plan,
      await guardOf(),
      new RegExp(
        `transaction 0 debits 16618655502 sompi from the wallet, over the ${MOST} sompi this buy allows`,
      ),
    );
  });

  test("★ the same overcharge alone refuses", async () => {
    const plan = realPlan((raw) => overcharge(raw, 2n * KAS));
    expect(debits(plan)).toEqual(["16618655502"]);
    await expectRefused(
      plan,
      await guardOf(),
      new RegExp(
        `debits 16618655502 sompi from the wallet, over the ${MOST} sompi this buy allows`,
      ),
    );
  });

  test("the total stays a second bound: two transactions each under it, over it together, refuse", async () => {
    // tx 1 spends the wallet's 1.74499999 KAS input into the pool vault.
    const plan = realPlan((raw) => addTx(raw, 4, 2));
    expect(debits(plan)).toEqual(["16418655502", "174499999"]);
    await expectRefused(
      plan,
      await guardOf(),
      new RegExp(
        `plan debits 16593155501 sompi from the wallet, over the ${MOST} sompi this buy allows`,
      ),
    );
  });

  test("an unreadable transaction has no per-transaction debit", () => {
    const plan = realPlan((raw) => {
      addTx(raw, 0, 1);
      raw.transactions[1].tx.fee = "1";
    });
    expect(signer.kaspaRocketWalletDebits(plan, REAL_XONLY_PK)).toBeNull();
    expect(signer.kaspaRocketWalletDebit(plan, REAL_XONLY_PK)).toBeNull();
  });

  test("★ the honest real buy passes, and all six wallet inputs are signed", async () => {
    // The real plan, re-keyed to a throwaway key (unit tests only, never
    // funded) so its six p2pkh inputs can be signed: the wallet's scripts
    // and the bought cell's owner move to that key, and the prepared
    // sighashes are recomputed. Amounts, covenants and summary are the
    // real plan's.
    const KEY =
      "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
    const pk = bytesToHex(schnorr.getPublicKey(hexToBytes(`0x${KEY}`))).slice(
      2,
    );
    const p2sh = (r: Uint8Array) =>
      `aa20${bytesToHex(blake2b256(r)).slice(2)}87`;
    const cell = p2sh(
      successorProgram(REAL_LEADER_PROGRAM, {
        amount: 5_298_975n,
        owner: hexToBytes(`0x${pk}`),
        ownerScheme: OWNER_SCHEME.P2PK_SCHNORR,
        borrowScheme: BORROW_SCHEME.DISABLED,
        borrowGuard: new Uint8Array(32),
        extensionCommitment:
          splitProgram(REAL_LEADER_PROGRAM).state.extensionCommitment,
      }),
    );
    const own = `20${REAL_XONLY_PK}ac`;
    const rekey = (raw: any) => {
      const t = tx0(raw);
      for (const i of t.inputs) {
        if (i.utxo.scriptPublicKey.script === own)
          i.utxo.scriptPublicKey.script = `20${pk}ac`;
      }
      for (const o of t.outputs) {
        if (o.scriptPublicKey.script === own)
          o.scriptPublicKey.script = `20${pk}ac`;
      }
      t.outputs[4].scriptPublicKey.script = cell;
    };
    // The re-keyed transaction's own digests, as the server would prepare.
    const digests = planDigests(realPlan(rekey));
    const plan = realPlan((raw) => {
      rekey(raw);
      for (const ins of raw.transactions[0].signingInstructions) {
        ins.sighash = digests.find(
          (d) => d.inputIndex === ins.inputIndex,
        )!.digest;
      }
    });

    expect(signer.kaspaRocketWalletDebits(plan, pk)?.map(String)).toEqual([
      "16418655502",
    ]);
    expect(String(kaspaRocketPlanNetworkFee(plan))).toBe("18658300");
    expect(
      String(signer.kaspaRocketPlanPayout(plan, REAL_TOKEN_ID, pk, "buy")),
    ).toBe("5298975");

    const calls: [number, number][] = [];
    const signed = await kastleKaspaRocketSigner(
      async (t, i) => {
        calls.push([t, i]);
        const d = digests.find((x) => x.txIndex === t && x.inputIndex === i)!;
        const sig = schnorr.sign(
          hexToBytes(`0x${d.digest}`),
          hexToBytes(`0x${KEY}`),
        );
        return new Uint8Array([...sig, 0x01]);
      },
      pk,
      await guardOf(),
    ).signPlan(plan);
    expect(calls).toEqual([2, 3, 4, 5, 6, 7].map((i) => [0, i]));
    expect(signed).toHaveLength(1);
    const scripts = (signed[0].inputs as { signatureScript: string }[]).map(
      (i) => i.signatureScript,
    );
    for (const i of [2, 3, 4, 5, 6, 7]) expect(scripts[i]).not.toBe("");
  });
});
