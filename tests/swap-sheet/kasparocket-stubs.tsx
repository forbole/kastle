// KaspaRocket on the real Swap screen: the copy-logs stubs, plus a client
// that answers from the synthetic plan fixture in its real-plan buy shape
// (its key owns nothing; see ../fixtures/kasparocket-synthetic-buy.ts) and a
// submit that is never reached. ?scenario=rocket-pending stores a record.
import fixture from "../fixtures/kasparocket-plan.synthetic.json";
import { syntheticBuyPlan } from "../fixtures/kasparocket-synthetic-buy";
import { ADDRESS, browser as base } from "../swap-bridge-copy-logs/stubs";

export * from "../swap-bridge-copy-logs/stubs";

export const ROCKET_TOKEN: string = fixture.tokenId;
const scenario = new URLSearchParams(location.search).get("scenario");

const store: Record<string, unknown> =
  scenario === "rocket-pending"
    ? {
        [`kasparocket_pending:mainnet:${ADDRESS}:KAS:${ROCKET_TOKEN}`]: {
          ref: "ab".repeat(32),
          pairKey: `KAS:${ROCKET_TOKEN}`,
          txids: ["ab".repeat(32)],
          direction: "buy",
          amountIn: "20000000000",
          startedAt: 1,
        },
      }
    : {};
export const browser = {
  ...base,
  storage: {
    local: {
      get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
      set: async (items: Record<string, unknown>) =>
        Object.assign(store, items),
      remove: async (k: string) => void delete store[k],
    },
  },
};

export const useFeatureFlags = () => ({
  isKcc20Enabled: true,
  isKaspaRocketEnabled: true,
});
const MARKETS = Object.assign(
  [
    {
      covenantId: ROCKET_TOKEN,
      entry: { symbol: "RKT", decimals: 8, logoURI: "" },
    },
  ],
  { graduated: [] },
);
export const fetchKronMarkets = async () => MARKETS;

export const useKaspaRocketListing = () => new Set([ROCKET_TOKEN]);
export const useKaspaRocketPool = () => ({
  pool: fixture.lpCovenantId as string,
  error: undefined,
  isLoading: false,
});

const q = fixture.quote;
export const makeKaspaRocket = () => ({
  protocol: async () => ({
    fees: {
      treasuryRate: 0.01,
      treasuryMinSompi: "200000000",
      partnerRate: 0.005,
      partnerMinSompi: "100000000",
    },
    limits: { minOrderValueSompi: "15000000000" },
    token: { decimals: 8 },
  }),
  // A buy's net is the KAS leaving the wallet, negative, as the server sends
  // it: the budget plus the 3 KAS fee, 2 798 sompi short of the budget into
  // the pool as on the real FOUR buy. ?scenario=rocket-overbudget asks one
  // sompi more than budget + fee.
  quote: async ({ kasBudgetSompi = 0n }: { kasBudgetSompi?: bigint }) => ({
    direction: q.direction,
    amountTokens: BigInt(q.amountTokens),
    kasFlowSompi: BigInt(q.kasFlowSompi),
    netKasSompi:
      -(kasBudgetSompi + 300_000_000n) +
      (scenario === "rocket-overbudget" ? -1n : 2_798n),
    uneconomic: false,
  }),
  planSwap: async () => {
    // The bought-token cell bound to the harness wallet's key (the copy-logs
    // stub's `publicKeys[0]`, x-only), as the hook reads the payout for it.
    const plan = syntheticBuyPlan({ ...fixture, xOnlyPk: "11".repeat(32) });
    return {
      ...plan,
      summary: {
        ...plan.summary,
        kasFlowSompi: BigInt(fixture.plan.summary.kasFlowSompi),
        totalPlatformFeeSompi: 300_000_000n,
      },
    };
  },
  submit: () => new Promise(() => {}),
});
export const kaspaRocketErrorCopy = (_e: unknown, fallback: string) => fallback;
