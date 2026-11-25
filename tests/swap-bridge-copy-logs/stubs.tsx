// The Bridge screen's hooks, WASM and Sentry for ./vite.config.mjs. ?scenario=
// picks what the L1 build throws: "node" (a node-style reason carrying an
// address and a txid, with a cause), "hostile" (an error whose toString
// throws, so its report cannot be built). The EVM leg is real viem: the spec
// answers the RPC.

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
  account: { address: ADDRESS },
  wallet: { type: "hot" },
});
export const useEvmAddress = () => OWNER;
export const useEvmHotWalletSigner = () => ({});
export const useKaspaHotWalletSigner = () => ({});
export const useKaspaPrice = () => ({ kaspaPrice: 0 });
export const useAnalytics = () => ({
  emitBridgeCompleted: ({ status }: { status: string }) =>
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
export const createTransactions = async () => {
  if (scenario === "hostile") {
    const error = new Error("node went away");
    error.toString = () => {
      throw new Error("hostile toString");
    };
    throw error;
  }
  throw new Error(
    `Storage mass exceeds maximum: change ${ADDRESS} after ${TXID}`,
    { cause: new Error("mass 120000 > 100000") },
  );
};
