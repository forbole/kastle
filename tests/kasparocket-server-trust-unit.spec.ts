import { test, expect } from "@playwright/test";
import { blake2b256 } from "@dotk/sdk";
import type { TransactionPlan } from "@kasparocket/sdk";
import { bytesToHex, hexToBytes } from "viem";
import * as signer from "@/lib/kasparocket/signer";
import { kaspaRocketFeesOf } from "@/lib/kasparocket/fees";
import { pushMinimal } from "@/lib/kcc20/standard/primitives";
import { splitProgram, successorProgram } from "@/lib/kcc20/standard/program";
import {
  BORROW_SCHEME,
  OWNER_SCHEME,
  type KCC20State,
} from "@/lib/kcc20/standard/state";
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

// What the signer takes on the server's word, on the real FOUR buy
// (fixtures/kasparocket-real-buy.ts): B the fee outputs, C the wallet's debit,
// D the bought-token cell. Nothing is signed: the signDigest below throws
// REACHED. A plan whose transaction was edited cannot reach it (its prepared
// sighashes no longer match), so "refused at the sighash check" is how such a
// plan shows it cleared every check before it. No network, no broadcast.
// (`import * as`: the file still loads against the pre-fix signer.)

const { KaspaRocketSignRefusal, kastleKaspaRocketSigner } = signer;
type KaspaRocketGuard = signer.KaspaRocketGuard;

const NOW = 1_000_000;
const REACHED = "reached the key: every pre-sign check passed";
const PAST_GUARD = /input 2 sighash does not match the prepared one/;
const PAYEE = /plan pays an address this wallet cannot spend/;
const DEBIT = /plan debits \d+ sompi from the wallet, over the \d+ sompi/;
const MIN_OUT = /plan pays less than the minimum shown/;
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

test.describe("C. the wallet's debit is bounded, from the transactions", () => {
  test("★ the real buy debits 164.18655502 KAS, under the 165.3 KAS it may", async () => {
    const plan = realPlan();
    expect(String(signer.kaspaRocketWalletDebit(plan, REAL_XONLY_PK))).toBe(
      "16418655502",
    );
    const fees = kaspaRocketFeesOf(realProtocol())!;
    expect(String(signer.kaspaRocketMaxBuyDebit(REAL_BUDGET_SOMPI, fees))).toBe(
      "16530000000",
    );
    // Why the bound carries the token cell's deposit: budget, fee and the
    // network ceiling alone (163.3 KAS) sit under the real debit.
    expect(
      16418655502n >
        REAL_BUDGET_SOMPI +
          3n * KAS +
          signer.KASPAROCKET_NETWORK_FEE_CEILING_SOMPI,
    ).toBe(true);
    expect(String(signer.KASPAROCKET_TOKEN_CELL_DEPOSIT_SOMPI)).toBe(
      outsOf(realPlan()).at(4).value,
    );
    await expectReached(plan);
  });

  test("★ extra change into an allowed covenant output refuses on the debit", async () => {
    // The pool vault (2), the token reserve (3), the bought-token cell (4):
    // each passes checkPayees on its covenant; quote, summary and network
    // fee all stay as they were.
    for (const to of [2, 3, 4]) {
      const plan = realPlan((raw) => moveChange(raw, to, 2n * KAS));
      expect(String(signer.kaspaRocketWalletDebit(plan, REAL_XONLY_PK))).toBe(
        "16618655502",
      );
      await expectRefused(
        plan,
        /plan debits 16618655502 sompi from the wallet, over the 16530000000 sompi this buy allows/,
      );
    }
  });

  test("★ the bound itself passes; one sompi over refuses", async () => {
    const slack = 16530000000n - 16418655502n;
    // At the bound: every check passes; the edit then fails the sighash.
    await expectRefused(
      realPlan((raw) => moveChange(raw, 3, slack)),
      PAST_GUARD,
    );
    await expectRefused(
      realPlan((raw) => moveChange(raw, 3, slack + 1n)),
      DEBIT,
    );
  });

  test("an unreadable transaction has no debit", () => {
    const plan = realPlan((raw) => (raw.transactions[0].tx.fee = "1"));
    expect(signer.kaspaRocketWalletDebit(plan, REAL_XONLY_PK)).toBeNull();
  });
});

// ---- D: the bought-token cell, bound to its program state ----

const hex = (b: Uint8Array) => bytesToHex(b).slice(2);
const p2sh = (r: Uint8Array) => `aa20${hex(blake2b256(r))}87`;
const cellState = (over: Partial<KCC20State> = {}): KCC20State => ({
  amount: 5_298_975n,
  owner: hexToBytes(`0x${REAL_XONLY_PK}`),
  ownerScheme: OWNER_SCHEME.P2PK_SCHNORR,
  borrowScheme: BORROW_SCHEME.DISABLED,
  borrowGuard: new Uint8Array(32),
  extensionCommitment:
    splitProgram(REAL_LEADER_PROGRAM).state.extensionCommitment,
  ...over,
});
const cellScript = (over?: Partial<KCC20State>) =>
  p2sh(successorProgram(REAL_LEADER_PROGRAM, cellState(over)));
const payout = (plan: TransactionPlan) =>
  String(
    signer.kaspaRocketPlanPayout(plan, REAL_TOKEN_ID, REAL_XONLY_PK, "buy"),
  );
const withCell = (script: string) =>
  realPlan((raw) => (outsOf(raw)[4].scriptPublicKey.script = script));

test.describe("D. the buy's payout is bound to the cell's bytes", () => {
  test("★ the real cell is the program's successor for 5298975 to the wallet's key", () => {
    expect(cellScript()).toBe(outsOf(realPlan()).at(4).scriptPublicKey.script);
    expect(payout(realPlan())).toBe("5298975");
  });

  test("★ a summary claiming more tokens than the cell holds refuses", async () => {
    // Summary only: the transaction, so its sighashes, are untouched.
    const plan = realPlan((raw) => {
      raw.summary.amountTokens = 6_000_000;
      raw.summary.userTokensAfter = 6_000_000;
    });
    expect(payout(plan)).toBe("null");
    await expectRefused(plan, MIN_OUT);
  });

  test("★ a cell holding fewer tokens, or owned by another key, is no payout", () => {
    expect(payout(withCell(cellScript({ amount: 1n })))).toBe("null");
    expect(
      payout(
        withCell(cellScript({ owner: hexToBytes(`0x${"cd".repeat(32)}`) })),
      ),
    ).toBe("null");
    // Borrowing enabled on the bought cell: not the state a buy writes.
    expect(
      payout(withCell(cellScript({ borrowScheme: BORROW_SCHEME.HASH_CHAIN }))),
    ).toBe("null");
  });

  test("the leader program must be the token's, the coin's own and allowlisted", () => {
    const leader = (raw: any) =>
      raw.transactions[0].tx.inputs[raw.summary.inputs.kcc20Leader];
    const cases: [string, (raw: any) => void][] = [
      ["no kcc20Leader index", (raw) => delete raw.summary.inputs.kcc20Leader],
      [
        "kcc20Leader on a plain input",
        (raw) => (raw.summary.inputs.kcc20Leader = 2),
      ],
      [
        "kcc20Leader on the pool's coin",
        (raw) => (raw.summary.inputs.kcc20Leader = 0),
      ],
      [
        "program does not hash to the coin",
        (raw) =>
          (leader(raw).utxo.scriptPublicKey.script =
            `aa20${"00".repeat(32)}87`),
      ],
      [
        "program outside the allowlist, coin rehashed to match",
        (raw) => {
          const bent = REAL_LEADER_PROGRAM.slice();
          bent[bent.length - 1] ^= 0xff;
          leader(raw).signatureScript = hex(pushMinimal(bent));
          leader(raw).utxo.scriptPublicKey.script = p2sh(bent);
        },
      ],
      [
        "signature script with a non-push opcode",
        (raw) =>
          (leader(raw).signatureScript = `51${leader(raw).signatureScript}`),
      ],
    ];
    for (const [name, edit] of cases) {
      expect(payout(realPlan(edit)), name).toBe("null");
    }
  });
});

test("★ the real plan, whole: every check passes and the key is reached", async () => {
  expect(String(REAL_NETWORK_FEE_SOMPI)).toBe("18658300");
  await expectReached(realPlan());
});
