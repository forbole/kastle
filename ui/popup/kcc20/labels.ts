// Every KCC-20 row in Figma is still dev-unmarked, so wording (and the
// unverified-token sort) may change: all user-facing copy lives here.

import { formatUnits } from "viem";
import { formatToken } from "@/lib/utils";

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

export const KCC20_LABELS = {
  // Token detail
  viewInExplorer: "See activity history in explorer",
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
  decimals: "Decimals",
  standard: "Standard",
  balance: "Balance",
  minter: "Minter",
  security: "Security",
  verified: "Verified",
  unverified: "Unverified",
  baseUnits: "base units",
  loadFailed: "Token details could not be loaded",

  // Send: select token
  selectToken: "Select token",
  searchLabel: "Search tokens",
  searchPlaceholder: "Search Token",
  loadingTokens: "Loading tokens…",
  noTokens: "No tokens available",
} as const;

/** The Standard row of Token info; native KAS has none. */
export const STANDARD_LABELS: Partial<Record<NetworkType, string>> = {
  kcc20: "KCC-20",
  krc20: "KRC-20",
  kasplexErc20: "ERC-20",
  igraErc20: "ERC-20",
};

/**
 * A KCC-20 amount as a person reads it: whole tokens with grouping. Unknown
 * decimals never pass for a scaled figure: grouped base units, named so.
 */
export function formatKcc20Amount(amount: bigint, decimals?: number) {
  if (decimals === undefined)
    return `${amount.toLocaleString("en-US")} ${KCC20_LABELS.baseUnits}`;
  const exact = formatUnits(amount, decimals);
  // Mobile's formatNumber: 3 places.
  const shown = formatToken(Number(exact), 3);
  // Below 3 places a non-zero amount must not read as "0".
  return shown === "0" && amount !== 0n ? exact : shown;
}

// A holding as the dashboard row and the detail page both show it. kascov
// held cells back when truncated: the balance may be short, hence "+".
export function formatKcc20Balance(token: {
  amount: bigint;
  truncated?: boolean;
  meta?: { decimals?: number };
}) {
  return `${formatKcc20Amount(token.amount, token.meta?.decimals)}${
    token.truncated ? "+" : ""
  }`;
}
