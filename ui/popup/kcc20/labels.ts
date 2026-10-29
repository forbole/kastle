// Every KCC-20 row in Figma is still dev-unmarked, so wording (and the
// unverified-token sort) may change: all user-facing copy lives here.

import type { Kcc20Family } from "@/lib/kcc20";

/** Where a token lives; drives the chip label, the chip colours and the corner badge. */
export type NetworkType =
  | "kcc20"
  | "krc20"
  | "kasplexErc20"
  | "igraErc20"
  | "kaspa";

export const NETWORK_TYPE_LABELS: Record<NetworkType, string> = {
  kcc20: "Kaspa-KCC20",
  krc20: "Kaspa-KRC20",
  kasplexErc20: "Kasplex-ERC20",
  igraErc20: "Igra-ERC20",
  kaspa: "Kaspa",
};

/** The Send token-list network filter; "kaspa" covers native KAS and KCC-20. */
export type NetworkFilter = "kaspa" | "krc20" | "kasplex" | "igra";

export const NETWORK_FILTER_LABELS: Record<NetworkFilter, string> = {
  kaspa: "Kaspa",
  krc20: "KRC20",
  kasplex: "Kasplex",
  igra: "Igra",
};

/** The family chip on a KCC-20 row; KRON's legacy state is never labelled plain KCC-20. */
export const KCC20_FAMILY_LABELS: Record<Kcc20Family, string> = {
  "kron-legacy": "KRON",
  "kcc20-standard": "KCC-20",
};

export const KCC20_LABELS = {
  // Token detail
  historyTab: "History",
  viewInExplorer: "See activity history in explorer",
  assetInfoTab: "Asset Info",
  tokenInfo: "Token Info",
  network: "Network",
  covenantId: "Covenant ID",
  contractAddress: "Contract Address",
  totalMinted: "Total Minted",
  mintCount: "Mint Count",
  holderCount: "Holder Count",
  transferCount: "Transfer Count",
  preallocationAmount: "Preallocation Amount",
  defaultMintAmount: "Default Mint Amount",
  decimal: "Decimal",
  minter: "Minter",
  security: "Security",
  verified: "Verified",
  unverified: "Unverified",
  claimedMetadata: "claimed metadata",
  /** Followed by the ticker: "Send NACHO". */
  send: "Send",

  // Send: select token
  selectToken: "Select token",
  searchLabel: "Search tokens",
  searchPlaceholder: "Search Token",
  loadingTokens: "Loading tokens…",
  noTokens: "No tokens available",
} as const;
