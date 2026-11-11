// Stand-ins for the wallet, settings and the KCC-20 pieces fetch; the confirm
// screen, the decode and the WASM are real. ?pieces= picks the fetch outcome.
const query = new URLSearchParams(location.search);

declare global {
  interface Window {
    __signHarness: {
      confirmed: number;
      cancelled: number;
      pieceCalls: unknown[];
    };
  }
}

// The kaspa.com repro's wallet input (input 2) and its two covenant inputs.
const WALLET =
  "kaspatest:qqvy0kf7yf2dzz0cmsaaf7gdt9nn6dh7ykvztdn9cev5wm0jp6dgv26v7c7mv";
const pieceA = {
  outpoint: {
    transactionId:
      "c95be92b71d2858ec179cd7f021c09022d226dc63ebf882eafaa07422e096990",
    index: 0,
  },
  covenantId:
    "ae3a6563b6374dc14c2b1bcd399c38a157f97c5a215ec26d0c33dfeaff91e5b8",
  family: "kron-legacy",
  amount: 125_000_000n,
  symbol: "AAA",
  decimals: 8,
};
const pieceB = {
  outpoint: {
    transactionId:
      "e5aa2289b808367ec116640e98e9e9618ecb434f681750c387cfba4276df55b2",
    index: 2,
  },
  covenantId:
    "2c4c9e0f46a412391b26499b2f23a14c3d3a965624deafc11d72c5200340dd36",
  family: "kron-legacy",
  amount: 42n,
  symbol: "",
};

export async function walletKcc20Pieces(...args: unknown[]) {
  window.__signHarness.pieceCalls.push(args.slice(2));
  switch (query.get("pieces")) {
    case "throw":
      throw new Error("indexer down");
    case "hang":
      return new Promise(() => {});
    case "a":
      return [pieceA];
    case "ab":
      return [pieceA, pieceB];
    default:
      return [];
  }
}

export function useWalletManager() {
  return {
    account: { address: WALLET, publicKeys: [] },
    wallet: { type: query.get("wallet") ?? "software" },
  };
}
export function useRpcClientStateful() {
  return { rpcClient: {} };
}
export function useFeatureFlags() {
  return { isKcc20StandardEnabled: false };
}
const settings = { networkId: "testnet-10", currency: "USD" };
export function useSettings() {
  return [settings, () => {}];
}
export function useKaspaPrice() {
  return { kaspaPrice: 0.1 };
}
export function useCurrencyValue(usd: number) {
  return { amount: usd, code: "USD" };
}

// Extension plumbing
export const Method = {};
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
  watch: () => () => {},
  defineItem: () => ({ getValue: async () => null, watch: () => () => {} }),
};
export const browser = {};
