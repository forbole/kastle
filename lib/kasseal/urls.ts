import type { KassealNetwork } from "@kassealhq/sdk";

// Kasseal's API CORS is locked to its own sites; see host_permissions in wxt.config.ts.
// A plain module: lib/kasseal runs during Swap's render and must not import
// contexts/SettingsContext (re-exported from there for existing callers).
export const KASSEAL_API_URLS: Record<KassealNetwork, string> = {
  mainnet: "https://app.kasseal.com/v1",
  "testnet-10": "https://testnet.kasseal.com/v1",
};
