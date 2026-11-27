// The Activity screen's data for ./vite.config.mjs: the QA wallet's swap rows
// as the data layer recorded them on 2026-11-26 (kascov + api.kaspa.org reads
// of its own transactions), the prices each source answered that day, and the
// hooks around them. Records go through the real mapSwapActivity.

export const ADDRESS =
  "kaspa:qre57qjr9cv23f2lux0l5ps79craefeu5gwglvez835h6dm836w2668gh9ekk";
export const PEPE_ID =
  "a73cdef004099b191759d320de970451be0e10423a7eb15b07d5e51d050b47cd";
export const BRD_ID =
  "b77cb1a7a9701cc4398edb5be836688feb13463a62f4f57da86104108ecddfe4";
export const KPEPE_ID =
  "6c5d77e7c094412389a07d1d4e96e079e24fc772a8c3e8fa3e134686da9f1a03";
export const KAS_USD = 0.02667811;
// kascov /token/{id}/market spots, KAS per whole token (0 decimals).
export const SPOTS: Record<string, number> = {
  [PEPE_ID]: 0.00009567268468664287,
  [KPEPE_ID]: 0.00013132628,
};

export enum NetworkType {
  Mainnet = "mainnet",
  TestnetT10 = "testnet-10",
}
export const kcc20TxLinks = { mainnet: "https://kascov.io/tx/" };
export const restApis = { mainnet: "" };

const local = new Map<string, unknown>();
export const browser = {
  runtime: { getManifest: () => ({ version: "9.9.9" }) },
  storage: {
    local: {
      get: async (key: string) => ({ [key]: local.get(key) }),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) local.set(k, v);
      },
    },
  },
};
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
};

export const useRpcClientStateful = () => ({ networkId: "mainnet" });
export const useWalletManager = () => ({ account: { address: ADDRESS } });
export const useKaspaPrice = () => ({ kaspaPrice: KAS_USD });
export const useFeatureFlags = () => ({
  isKcc20Enabled: true,
  isKcc20StandardEnabled: true,
});
export const useSettings = () => [{ networkId: "mainnet", currency: "USD" }];
export const BottomNav = () => null;

// Zealous lists, 2026-11-26: the KRC-20 "PEPE" (Kasplex) and the ERC-20
// "KPEPE" (Igra) are other issuances than the KCC-20 tokens of the same name.
const zealous = (tokens: object[]) => ({ data: { tokens } });
const KASPLEX = zealous([
  { symbol: "WKAS", price: 0.02634642, decimals: 18 },
  { symbol: "PEPE", price: 0.000002858355099295944, decimals: 18 },
]);
const IGRA = zealous([
  { symbol: "WiKAS", price: 0.02637488, decimals: 18 },
  { symbol: "IGRA", price: 0.0021363220876219366, decimals: 18 },
  { symbol: "KPEPE", price: 0.017943390347176052, decimals: 18 },
]);
export const useZealousSwapTokensMetadata = () => KASPLEX;
export const useZealousSwapIgraTokensMetadata = () => IGRA;
export const ZEALOUS_SWAP_IMAGE_URL = "";
export const ZEALOUS_SWAP_IGRA_IMAGE_URL = "";

const held = (covenantId: string, symbol: string, amount: bigint) => ({
  covenantId,
  family: "kcc20-standard",
  tick: symbol,
  amount,
  spendable: amount,
  meta: { symbol, name: symbol, decimals: 0 },
});
const TOKENS = [held(PEPE_ID, "PEPE", 27392n), held(KPEPE_ID, "KPEPE", 77000n)];
export const useKcc20Tokens = () => ({ data: TOKENS, isLoading: false });
export const fetchStandardMarketPrice = async (id: string) => SPOTS[id] ?? null;
export const fetchKronMarkets = async () =>
  Object.assign([], {
    graduated: [
      { covenantId: PEPE_ID, priceKas: SPOTS[PEPE_ID] },
      // The Braid round trip's token (records.ts BRAID), at its sell's price.
      { covenantId: BRD_ID, priceKas: 0.0002 },
    ],
  });

// main.tsx maps RECORDS (./records.ts) through the real mapSwapActivity: a
// stub importing the mappers would close an import cycle back into this file.
export const useActivityFeed = () =>
  (window as unknown as { __feed: unknown }).__feed;
