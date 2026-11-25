import { useEffect } from "react";
import { useFormContext } from "react-hook-form";

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
      // build rejects with an Error object; bug: the build throws a TypeError;
      // reject: the node refuses the broadcast, naming an address and a txid;
      // hostile: the broadcast error's `.cause` getter throws.
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
export const useAnalytics = () => ({
  emitFirstTransaction: async () => {},
  emitSendCompleted: () => {},
});
export const useKaspaHotWalletSigner = () => ({
  getAddress: async () => OWNER,
});

// KasSend's other steps. The details step fills what the real one would and
// moves on to Confirm.
export function DetailsStep({ onNext }: { onNext: () => void }) {
  const { setValue } = useFormContext();
  useEffect(() => {
    setValue("address", "kaspa:qrecipient1");
    setValue("amount", "1");
    onNext();
  }, []);
  return null;
}
export const SuccessStatus = () => null;
export const LedgerConfirm = () => null;
export const explorerTxLinks = {};
export const useKasFeeEstimate = () => ({ fee: 2000, transactionCount: 1 });

// Batch signer
export const REJECT = `RPC Server (remote error): transaction ${"ab".repeat(32)} rejected: input owned by kaspa:qpz2vgvlxhmyhmt22h538pjzmvvd52nuut80y5zulgpvyerlskvvwm7n4uk0a is already spent`;
export async function signAndSubmitBatch() {
  if (h().scenario === "broadcast") throw new Error(MASS);
  if (h().scenario === "reject") throw new Error(REJECT);
  if (h().scenario === "hostile") {
    const error = new Error("node went away");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("hostile cause");
      },
    });
    throw error;
  }
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
  runtime: { getManifest: () => ({ version: "9.9.9" }) },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
