// Stubs for what the KAS ConfirmStep reaches into. The scenario comes from the
// page's query string (see main.tsx); calls are recorded on window.__kasConfirm.

export const OWNER = "kaspa:qowner";
const MASS = "Storage mass exceeds maximum";

declare global {
  interface Window {
    __kasConfirm: {
      // mass: the WASM build throws the mass error; short: the UTXOs fetched
      // at Confirm cover less than the amount; broadcast: the build succeeds
      // and signAndSubmitBatch throws the mass error; mass-error: the WASM
      // build rejects with an Error object; bug: the build throws a TypeError.
      scenario: string;
      captured: string[];
      failed: (string | undefined)[];
    };
  }
}

const h = () => window.__kasConfirm;

// Sentry
export const captureException = (e: unknown) => {
  h().captured.push(String(e));
};

// Hooks
export const useWalletManager = () => ({
  wallet: { type: "privateKey", isLegacyWalletEnabled: false },
  account: { address: OWNER },
});
export const useKaspaBalance = () => 1000;
const rpcClient = {
  getUtxosByAddresses: async () => ({
    entries: [
      { amount: h().scenario === "short" ? 50_000_000n : 100_000_000_000n },
    ],
  }),
};
export const useRpcClientStateful = () => ({ rpcClient, networkId: "mainnet" });
export const useRecentAddresses = () => ({ addRecentAddress: async () => {} });
export const useKaspaPrice = () => ({ kaspaPrice: 0.1 });
export const useCurrencyValue = (amount: number) => ({ amount, code: "USD" });
export const useAnalytics = () => ({ emitFirstTransaction: async () => {} });
export const useKasFeeEstimate = () => ({ fee: 2000, transactionCount: 1 });

// Batch signer
export async function signAndSubmitBatch() {
  if (h().scenario === "broadcast") throw new Error(MASS);
  return ["tx1"];
}

// WASM
export async function createTransactions() {
  if (h().scenario === "mass") throw MASS; // the WASM throws bare strings
  // KASTLE-13 is titled "Error: Storage mass exceeds maximum": an Error object.
  if (h().scenario === "mass-error") throw new Error(MASS);
  // A genuine planner bug, not one of the three fragmentation texts.
  if (h().scenario === "bug")
    throw new TypeError("Cannot read properties of null");
  return {
    transactions: [{ feeAmount: 2000n }],
    summary: { fees: 2000n },
  };
}
export function kaspaToSompi(kas: string) {
  return BigInt(Math.round(parseFloat(kas) * 1e8));
}
export function sompiToKaspaString(sompi: bigint | number) {
  return (Number(sompi) / 1e8).toString();
}
// lib/utils maps this enum at import time.
export const SighashType = {};

// Extension plumbing
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
  watch: () => () => {},
  defineItem: () => ({ getValue: async () => null, watch: () => () => {} }),
};
export const browser = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
