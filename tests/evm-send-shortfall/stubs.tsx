import type { IWalletWithGetAddress } from "@/lib/ethereum/wallet/wallet-interface";

declare global {
  interface Window {
    __evmSend: { responses: unknown[]; signed: number };
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

export const useSettings = () => [
  { networkId: "mainnet", evmL2ChainId: { mainnet: 202_555 } },
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
