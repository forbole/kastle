import { NetworkType } from "@/contexts/SettingsContext";
import { explorerTxLinks, restApis } from "@/components/screens/Settings";
import { KASTLE_FEE_ADDRESS as KASTLE_FEE_BY_NETWORK } from "@/lib/bridge/bridge";

// kastle-mobile's lib/externals shapes, keyed by NetworkType, so the ported
// activity modules read them unchanged. Values come from the extension's own
// constants — nothing here is a second copy of an address or URL.
export const KASPA_REST_APIS = restApis;
export const TX_EXPLORER = explorerTxLinks;
export const KASTLE_FEE_ADDRESS = {
  [NetworkType.Mainnet]: KASTLE_FEE_BY_NETWORK.mainnet,
  [NetworkType.TestnetT10]: KASTLE_FEE_BY_NETWORK.testnet,
};

// KAT's L1 fee collector (mobile lib/bridge/kaspa-kat.ts). The extension's
// bridge flow never pays it directly, so it had no home here before.
export const KAT_FEE_ADDRESS =
  "kaspa:qypca63358auyh2hxdvnxmjleu7snzytrkgwt46a3tr6k2l8xcpvelqhygnprgs";
