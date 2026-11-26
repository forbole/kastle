// The Bridge and Swap screens' hooks, WASM and Sentry for ./vite.config.mjs.
// ?scenario= picks what the L1 build (Bridge), the KRON submit and the Braid
// prepare (Swap) throw: "node" (a node-style reason carrying an address and a
// txid, with a cause), "hostile" (an error whose toString throws, so its
// report cannot be built). The EVM legs are real viem: the spec answers the
// RPC.

declare global {
  interface Window {
    __bridge: { emitted: string[] };
  }
}

export const ADDRESS =
  "kaspa:qr0lr4ml9fn3chekrqmjdkergxl93l4wrk3dankcgvjq776s9wn9jkdskewva";
export const TXID = "ab".repeat(32);
const OWNER = "0x00000000000000000000000000000000000000aa";
const scenario = new URLSearchParams(location.search).get("scenario");

export enum NetworkType {
  Mainnet = "mainnet",
  TestnetT10 = "testnet-10",
}

export const browser = {
  runtime: { getManifest: () => ({ version: "9.9.9" }) },
};
export const captureException = () => {};

export const useRpcClientStateful = () => ({
  networkId: "mainnet",
  rpcClient: { getUtxosByAddresses: async () => ({ entries: [] }) },
});
export const useWalletManager = () => ({
  account: { address: ADDRESS, publicKeys: ["02" + "11".repeat(32)] },
  wallet: { type: "hot" },
});
export const useEvmAddress = () => OWNER;
export const useEvmHotWalletSigner = () => ({});
export const useKaspaHotWalletSigner = () => ({
  signBraidDeposit: async () => ({}),
});
// ?kas= sets the KAS price (USD); absent, 0: no price yet.
const kasPrice = Number(new URLSearchParams(location.search).get("kas") ?? 0);
export const useKaspaPrice = () => ({ kaspaPrice: kasPrice });
export const useAnalytics = () => ({
  emitBridgeCompleted: ({ status }: { status: string }) =>
    window.__bridge.emitted.push(status),
  emitSwapCompleted: ({ status }: { status: string }) =>
    window.__bridge.emitted.push(status),
});
export const useKcc20Migration = () => undefined;
export const migrationRowUrl = () => undefined;
export const useKaspaBalance = () => 1000;
export const useEvmKasBalance = () => ({ data: { balance: "1000" } });
export const useFeeEstimateByGas = () => ({ data: 10n ** 15n });
export const useKasFeeEstimate = () => ({ fee: 2000 });
// TermsGate already accepted; recent-token lists empty. The setter is async
// like the real hook: TokenSheet chains .catch() on it, and a sync no-op
// threw there, so a row pick never reached onSelect.
export const useStorageState = (key: string, init: unknown) => [
  key.includes("terms_accepted") ? true : init,
  async () => {},
  false,
];
export const BottomNav = () => null;
export const ActivityHeaderButton = () => null;
export const trackKurveBridge = () => {};
export const signAndSubmitBatch = async () => [];

export const kaspaToSompi = (kas: string) =>
  BigInt(Math.round(Number(kas) * 1e8));
const fail = (reason: string, cause: string) => {
  if (scenario === "hostile") {
    const error = new Error("node went away");
    error.toString = () => {
      throw new Error("hostile toString");
    };
    throw error;
  }
  throw new Error(`${reason}: change ${ADDRESS} after ${TXID}`, {
    cause: new Error(cause),
  });
};
export const createTransactions = async () =>
  fail("Storage mass exceeds maximum", "mass 120000 > 100000");

// Swap: KRON curve token KRN, Braid-only token BRD; KAS -> either is a buy.
export const KRON_ID = "c1".repeat(32);
export const BRAID_ID = "b2".repeat(32);
export const SWAP_GAS_ESTIMATES = {
  WRAP: 1n,
  UNWRAP: 1n,
  KAS_TO_ERC20: 1n,
  ERC20_TO_KAS: 1n,
  ERC20_TO_ERC20: 1n,
  APPROVAL: 1n,
};
export const useSwitchNetwork = () => ({ switchKaspaNetwork: () => {} });
export const useFeatureFlags = () => ({ isKcc20Enabled: true });
export const useSettings = () => [{ networkId: "mainnet" }];
export const useErc20Price = () => ({ price: 0 });
export const useErc20Assets = () => ({ assets: [] });
export const useErc20Balances = () => ({ data: [] });
export const useEvmKasBalances = () => ({ data: {} });
export const useZealousSwapTokensMetadata = () => ({ data: undefined });
export const useZealousSwapIgraTokensMetadata = () => ({ data: undefined });
export const ZEALOUS_SWAP_IMAGE_URL = "";
export const ZEALOUS_SWAP_IGRA_IMAGE_URL = "";
export const useKcc20Tokens = () => ({ data: [] });
export const useKcc20Price = () => ({ priceUsd: undefined });
export const decimalsError = () => undefined;
export const hiddenTokensKey = () => "hidden";
export const swapRowHideId = () => undefined;
export const useVisibleTokens = (_key: string, items: unknown[]) => ({
  items,
});
export const restApis = { mainnet: "" };
export const KCC20_LEDGER_UNSUPPORTED_MESSAGE = "Ledger unsupported";

const KRON_MARKETS = Object.assign(
  [{ covenantId: KRON_ID, entry: { symbol: "KRN", decimals: 8, logoURI: "" } }],
  { graduated: [] },
);
export const fetchKronMarkets = async () => KRON_MARKETS;
export const assertKronVerified = async () => {};
// The Kastle fee lib/kcc20/swap.ts kronKastleFee takes: 0.75% of the KAS in,
// floored at the SDK's 0.2 KAS fee output.
export const buildKronSwap = async (a: {
  side: "buy" | "sell";
  amountIn: bigint;
}) => {
  const rate = (a.amountIn * 75n) / 10_000n;
  const kastleFee = rate > 20_000_000n ? rate : 20_000_000n;
  return {
    quote: {
      side: a.side,
      amountIn: a.amountIn,
      amountOut: 5n * 10n ** 8n,
      curveFee: 0n,
      kastleFee,
    },
    fee: 1000n,
  };
};
export const kronErrorCopy = (_e: unknown, fallback: string) => fallback;
export const submitKronSwap = async () =>
  fail("KRON broadcast rejected", "orphan transaction");

export const useBraidListing = (net?: string) =>
  net && [
    {
      covenantId: BRAID_ID,
      family: "kcc20-standard",
      symbol: "BRD",
      decimals: 8,
      logo: "",
    },
  ];
export const useBraidRoutable = (net?: string) => net && new Set([BRAID_ID]);
// useBraidSwap reads Braid's list through the real ./braidListing (a relative
// import no alias reaches): it needs one listed, non-builtin pool.
export const makeBraid = () => ({
  tokens: async () => [{ id: BRAID_ID, lineage: "ref", builtin: false }],
  quote: async () => ({
    amountOut: 10n ** 8n,
    minOut: 10n ** 8n,
    payTotal: "100000000",
    walletFee: { amount: 0n },
    braidFee: 0n,
    warnings: [],
    raw: {},
  }),
  prepare: async () => fail("Braid prepare refused", "deadline passed"),
  submit: async () => {},
});
export const braidErrorCopy = (_e: unknown, fallback: string) => fallback;
export class BraidSignRefusal extends Error {}
export const claimBraidPair = async () => true;
export const releaseBraidPair = async () => {};
export const isBraidPending = async () => false;
export const getPendingBraidSwaps = async () => [];
export const registerBraidSwap = async () => {};
export const subscribeBraidSwaps = () => () => {};
