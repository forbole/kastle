// KaspaRocket on the real Swap screen: the copy-logs stubs, plus a client
// that answers from the synthetic plan fixture (its key owns nothing) and a
// submit that is never reached. ?scenario=rocket-pending stores a record.
import fixture from "../fixtures/kasparocket-plan.synthetic.json";
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
  quote: async () => ({
    direction: q.direction,
    amountTokens: BigInt(q.amountTokens),
    kasFlowSompi: BigInt(q.kasFlowSompi),
    netKasSompi: BigInt(q.netKasSompi),
    uneconomic: false,
  }),
  planSwap: async () => {
    const plan = JSON.parse(JSON.stringify(fixture.plan));
    return {
      ...plan,
      summary: {
        ...plan.summary,
        kasFlowSompi: BigInt(plan.summary.kasFlowSompi),
        totalPlatformFeeSompi: 300_000_000n,
      },
    };
  },
  submit: () => new Promise(() => {}),
});
export const kaspaRocketErrorCopy = (_e: unknown, fallback: string) => fallback;
