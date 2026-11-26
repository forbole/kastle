import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import type { TransactionPlan } from "@kasparocket/sdk";
import { kaspaRocketPlanPayout } from "@/lib/kasparocket/signer";

// REAL: a server-built /pro-api/plan/trade buy (FOUR for 160 KAS), trimmed to
// its summary and transaction. No network, no signing, no broadcast.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const real = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/kasparocket-plan.trade-buy-FOUR.real.json"),
    "utf8",
  ),
);

const BOUGHT = "5298975";
// The wallet's own pay-to-pubkey, as outputs 0 and 1 of the real plan carry it.
const OWN_P2PK = `20${real.xOnlyPk}ac`;

/** A copy of the real plan, optionally edited. */
function planOf(
  edit?: (plan: any) => void,
  { sdkParsed = false } = {},
): TransactionPlan {
  const raw = JSON.parse(JSON.stringify(real.plan));
  // What the SDK's parseAmounts hands the app: `amountTokens` (a u64 field)
  // becomes a bigint, `userTokensAfter` (not one) stays a JSON number.
  if (sdkParsed) raw.summary.amountTokens = BigInt(raw.summary.amountTokens);
  edit?.(raw);
  return raw as TransactionPlan;
}

const payout = (plan: TransactionPlan, tokenId = real.tokenId as string) =>
  // String(): a failing bigint expect crash-loops the Playwright worker.
  String(kaspaRocketPlanPayout(plan, tokenId, real.xOnlyPk, "buy"));

const userCell = (plan: any) =>
  plan.transactions[0].tx.outputs[plan.summary.outputs.kcc20User];

test.describe("kaspaRocketPlanPayout, buy, real plan", () => {
  test("the fixture is the shape the defect was found on", () => {
    const plan = planOf();
    const outs = plan.transactions[0].tx.outputs as any[];
    expect(outs).toHaveLength(6);
    expect(plan.transactions[0].tx.inputs as any[]).toHaveLength(8);
    const cell = userCell(plan);
    // The cell's value is its KAS rent, not the tokens; its script is P2SH.
    expect(cell.value).toBe("200000000");
    expect(cell.scriptPublicKey.script).toMatch(/^aa20[0-9a-f]{64}87$/);
    expect(cell.covenant.covenantId).toBe(real.tokenId);
    // The bought amount is nowhere in the transaction.
    expect(JSON.stringify(plan.transactions[0].tx)).not.toContain(BOUGHT);
    expect(String(plan.summary.amountTokens)).toBe(BOUGHT);
  });

  test("★ returns the bought amount, 5298975", () => {
    expect(payout(planOf())).toBe(BOUGHT);
  });

  test("★ returns it from the SDK-parsed summary too (bigint amountTokens)", () => {
    expect(payout(planOf(undefined, { sdkParsed: true }))).toBe(BOUGHT);
  });

  test("★ refuses a kcc20User output on the wallet's pay-to-pubkey (the old shape)", () => {
    // The old reading: tokens in `value` on the wallet's own script.
    const plan = planOf((p) => {
      const cell = userCell(p);
      cell.scriptPublicKey.script = OWN_P2PK;
      cell.value = BOUGHT;
    });
    expect(payout(plan)).toBe("null");
    // Same, in the safe-JSON wire form (version prefix on the script).
    const safe = planOf((p) => {
      userCell(p).scriptPublicKey = `0000${OWN_P2PK}`;
    });
    expect(payout(safe)).toBe("null");
  });

  test("★ refuses a kcc20User index on another covenant's output", () => {
    // Output 2 is the LP vault: P2SH, but the pool's covenant, not the token's.
    expect(payout(planOf((p) => (p.summary.outputs.kcc20User = 2)))).toBe(
      "null",
    );
    // Output 3 is the token's covenant, but asked for as another token.
    expect(payout(planOf(), "ab".repeat(32))).toBe("null");
    // And a cell without a covenant at all (output 1, the KAS change).
    expect(payout(planOf((p) => (p.summary.outputs.kcc20User = 1)))).toBe(
      "null",
    );
  });

  test("refuses when the summary does not hold together", () => {
    const cases: [string, (p: any) => void][] = [
      ["amounts disagree", (p) => (p.summary.userTokensAfter = 5298976)],
      ["no amountTokens", (p) => delete p.summary.amountTokens],
      ["no userTokensAfter", (p) => delete p.summary.userTokensAfter],
      ["fractional amount", (p) => (p.summary.amountTokens = 5298975.5)],
      ["negative amount", (p) => (p.summary.amountTokens = -1)],
      ["not a buy", (p) => (p.summary.direction = "sell")],
      ["no outputs map", (p) => delete p.summary.outputs],
      ["index past the end", (p) => (p.summary.outputs.kcc20User = 6)],
      ["index not an integer", (p) => (p.summary.outputs.kcc20User = "4")],
      ["index negative", (p) => (p.summary.outputs.kcc20User = -1)],
      ["script version 1", (p) => (userCell(p).scriptPublicKey.version = 1)],
      ["no covenant", (p) => (userCell(p).covenant = null)],
      [
        "a transaction without outputs",
        (p) => delete p.transactions[0].tx.outputs,
      ],
    ];
    for (const [name, edit] of cases) {
      expect(payout(planOf(edit)), name).toBe("null");
    }
  });
});
