// Stubs for the send picker's KCC-20 row harness. Knob from the query string:
//   krc20=<n>   the KRC-20 list holds n NACHO entries (0 when absent)
import { fillFromKrc20 } from "@/lib/kcc20/krc20Fill";
import type { Kcc20Token } from "@/lib/kcc20";

const query = new URLSearchParams(location.search);
export const NACHO_LOGO = "https://x/nacho.png";

export function useWalletManager() {
  return {
    account: { address: "kaspa:qowner", publicKeys: [] },
    wallet: { type: "software" },
    isWalletSettingsLoading: false,
    walletSettings: { selectedAccountIndex: 0 },
  };
}

// As the real hook: the row through fillFromKrc20 against the KRC-20 list.
export function useKrc20FilledToken<T extends Kcc20Token | undefined>(
  token: T,
): T {
  const n = Number(query.get("krc20") ?? 0);
  const list = Array.from({ length: n }, () => ({
    symbol: "NACHO",
    decimals: 8,
    logoURI: NACHO_LOGO,
  }));
  return (token && fillFromKrc20(token, list)) as T;
}

// Extension plumbing
export function Tab() {
  return null;
}
export const browser = {
  tabs: { create: () => {} },
  runtime: { sendMessage: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
(window as unknown as { browser: unknown }).browser = browser;
export const captureException = () => {};
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
  watch: () => () => {},
  defineItem: () => ({ getValue: async () => null, watch: () => () => {} }),
};
export const SighashType = {};
