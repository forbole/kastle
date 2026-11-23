import { useSyncExternalStore } from "react";
import type { IWalletWithGetAddress } from "@/lib/ethereum/wallet/wallet-interface";

declare global {
  interface Window {
    __evmSend: { responses: unknown[]; signed: number };
    // Switches the selected mainnet L2 chain, as the network selector would.
    __evmSetChain: (id: number) => void;
  }
}
window.__evmSend = { responses: [], signed: 0 };

export const walletSigner = {
  getAddress: async () => "0x00000000000000000000000000000000000000aa",
  signTransaction: async () => {
    window.__evmSend.signed++;
    return "0x02f0";
  },
} as unknown as IWalletWithGetAddress;

let settings = { networkId: "mainnet", evmL2ChainId: { mainnet: 202_555 } };
const listeners = new Set<() => void>();
window.__evmSetChain = (id) => {
  settings = { ...settings, evmL2ChainId: { mainnet: id } };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSettings = () => [
  useSyncExternalStore(subscribe, () => settings),
];
export const useWalletManager = () => ({ wallet: { type: "hot" } });
export const useAnalytics = () => ({ emitEthSendTransaction: () => {} });

// What the page receives.
export const ApiExtensionUtils = {
  sendMessage: async (_id: string, response: unknown) => {
    window.__evmSend.responses.push(response);
  },
};
export const ApiUtils = {
  createApiResponse: (id: string, response: unknown, error?: unknown) => ({
    id,
    response,
    error,
  }),
};
