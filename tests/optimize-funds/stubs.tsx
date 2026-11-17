// Stand-ins for the hooks OptimizeFunds reads. One store drives them all so a
// test can switch the account or the signer's key mid-page, the way an account
// switch or a legacy-mode toggle does in the popup.
import { useSyncExternalStore } from "react";
import {
  payToAddressScript,
  type IUtxoEntry,
  type Transaction,
} from "@/wasm/core/kaspa";

export type HarnessState = {
  accountAddress: string;
  accountIndex: number;
  isLegacy: boolean;
  // what the signer's own key derives; undefined = no signer (Ledger offline)
  signerAddress: string | undefined;
  // getAddress rejects (locked keyring)
  signerFails: boolean;
  isLedger: boolean;
  // entries the node lists, per address
  entryCounts: Record<string, number>;
  calls: {
    getAddress: number;
    signTx: number;
    submit: number;
    revalidate: number;
  };
  failed?: { errorName?: string; report?: Record<string, unknown> };
  succeeded?: boolean;
};

let state: HarnessState;
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const useVersion = () => useSyncExternalStore(subscribe, () => version);

export function initStore(initial: HarnessState) {
  state = initial;
}
export function getState() {
  return state;
}
export function update(patch: Partial<HarnessState>) {
  state = { ...state, ...patch };
  version++;
  listeners.forEach((l) => l());
}

const entriesFor = (address: string): IUtxoEntry[] => {
  const script = payToAddressScript(address);
  return Array.from({ length: state.entryCounts[address] ?? 0 }, (_, i) => ({
    address,
    outpoint: {
      transactionId: (i + 1).toString(16).padStart(64, "0"),
      index: 0,
    },
    amount: 206_040_000n,
    scriptPublicKey: { version: script.version, script: script.script },
    blockDaaScore: 1_000n,
    isCoinbase: false,
  })) as unknown as IUtxoEntry[];
};

export function useWalletManager() {
  useVersion();
  return {
    wallet: {
      id: "wallet-1",
      type: state.isLedger ? "ledger" : "mnemonic",
      isLegacyWalletEnabled: state.isLegacy,
    },
    account: { address: state.accountAddress, index: state.accountIndex },
  };
}

const rpcClient = {
  url: "wss://stub.invalid",
  isConnected: true,
  getBlockDagInfo: async () => ({ virtualDaaScore: 10_000_000n }),
  submitTransaction: async () => {
    state.calls.submit++;
    return { transactionId: "00".repeat(32) };
  },
};

export function useRpcClientStateful() {
  return { rpcClient, networkId: "mainnet", isConnected: true };
}

// Like the real hooks: a fresh object every render, reading the key the
// account / legacy setting of that render derives.
function useSigner() {
  useVersion();
  const address = state.signerAddress;
  if (address === undefined) return undefined;
  return {
    getAddress: async () => {
      state.calls.getAddress++;
      if (state.signerFails) throw new Error("Keyring is locked");
      return address;
    },
    // signAndSubmitBatch refuses inputs with an empty signature script: put
    // a placeholder where the real signature would go, on every input
    signTx: async (tx: Transaction) => {
      state.calls.signTx++;
      tx.inputs = tx.inputs.map((input) => {
        input.signatureScript = "00";
        return input;
      });
      return tx;
    },
  };
}

export function useKaspaHotWalletSigner() {
  const signer = useSigner();
  return state.isLedger ? undefined : signer;
}

export function useKaspaLedgerSigner() {
  const signer = useSigner();
  return state.isLedger ? signer : undefined;
}

export function useKasFeeEstimate() {
  return {};
}

export function useUtxoEntries(address: string | undefined) {
  return {
    mutate: async () => {
      state.calls.revalidate++;
      return address ? entriesFor(address) : [];
    },
  };
}

export function LedgerConnectForSign() {
  return <div data-testid="ledger-connect">Connect your Ledger</div>;
}

export function GeneralHeader({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
