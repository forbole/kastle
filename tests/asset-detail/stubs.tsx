// Stubs for the data hooks and tab bodies of the asset detail screens.
// Knobs from the query string, one for each Send guard, so a case changes one
// guard only:
//   ledger=1      the wallet is a Ledger
//   walletLoading=1  wallet settings have not loaded: no wallet yet
//   kas0=1        the KAS balance is 0
//   notOwner=1    someone else owns the .k name
//   dotkOff=1     the dotK feature flag is off
//   spendable0=1  the KCC-20 token has nothing spendable
//   tall=1        every tab body is taller than the popup
import type { Kcc20Token } from "@/lib/kcc20";

export const OWNER = "kaspa:qowner";
const query = new URLSearchParams(location.search);
const ledger = query.has("ledger");
const walletLoading = query.has("walletLoading");
const kas0 = query.has("kas0");
const notOwner = query.has("notOwner");
const dotkOff = query.has("dotkOff");
const spendable0 = query.has("spendable0");
const tall = query.has("tall");

// KRC-20 in issue mode: the route carries the contract id, the title is the
// name. One unbroken word, so a title that cannot wrap would overflow.
export const ISSUE_CA = "kaspa:qissuetoken";
export const ISSUE_NAME = "KaspaIssueModeTokenWithAVeryLongName";
// A second KCC-20 row for the same token id, named by its extension.
export const KCC20_EXT = "cd".repeat(32);

(window as unknown as { browser: unknown }).browser = {
  tabs: { create: () => {} },
  action: { setPopup: () => {} },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};

export const kcc20Token: Kcc20Token = {
  covenantId: "ab".repeat(32),
  family: "kcc20-standard",
  tick: "ktest",
  amount: 1_000_000n,
  spendable: spendable0 ? 0n : 1_000_000n,
  meta: { symbol: "KTEST", name: "Kastle test", decimals: 2 },
};
const kcc20ExtToken: Kcc20Token = {
  ...kcc20Token,
  extensionCommitment: KCC20_EXT,
};

// Wallet and network
export function useWalletManager() {
  return {
    account: { address: OWNER, publicKeys: [] },
    wallet: walletLoading
      ? undefined
      : { type: ledger ? "ledger" : "software" },
    isWalletSettingsLoading: walletLoading,
    walletSettings: { selectedAccountIndex: 0 },
  };
}
export function useRpcClientStateful() {
  return { rpcClient: {}, networkId: "mainnet" };
}
export function useFeatureFlags() {
  return { isKcc20Enabled: true, isDotkEnabled: !dotkOff };
}
export function useSettings() {
  return [{ currency: "USD", hideBalances: false }, async () => {}];
}
export const explorerAddressLinks = {
  mainnet: "https://explorer.kaspa.org/addresses/",
};

// Balances
export function useKaspaBalance() {
  return kas0 ? 0 : 100;
}
export function useTokenInfo(tick?: string) {
  if (!tick) return { data: undefined };
  return {
    data: {
      result: [
        tick === ISSUE_CA
          ? { ca: tick, name: ISSUE_NAME, dec: "8", mod: "issue" }
          : { tick, name: tick, dec: "8", mod: "mint" },
      ],
    },
  };
}
export function useTokenBalance() {
  return {
    data: { result: [{ balance: "100000000000", dec: "8" }] },
  };
}
export function useErc20Info(chainId: string, address: string) {
  return {
    chainId,
    address,
    symbol: "WKAS",
    name: "Wrapped KAS",
    decimals: 18,
  };
}
export function useErc20Balance() {
  return { data: { balance: "1000" } };
}
export function useEvmKasBalance() {
  return { data: { balance: "1000" } };
}
export function useKcc20Tokens() {
  return { data: [kcc20Token, kcc20ExtToken], isLoading: false };
}
export function useDotkName() {
  return {
    lookup: {
      kind: "active",
      resolved: {
        address: notOwner ? "kaspa:qsomeoneelse" : OWNER,
        deedAddress: "kaspa:qdeed",
        records: {},
      },
    },
    isLoading: false,
    error: undefined,
  };
}

// Tab bodies and cards: placeholders, the tabs are not under test.
export function Tab() {
  return (
    <div
      data-testid="tab-body"
      className="shrink-0"
      style={{ height: tall ? 1000 : 40 }}
    />
  );
}
export function NameCard({ name }: { name: string }) {
  return (
    <div data-testid="name-card" style={{ height: tall ? 1000 : 40 }}>
      {name}
    </div>
  );
}

// Extension plumbing
export const captureException = () => {};
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
  watch: () => () => {},
  defineItem: () => ({ getValue: async () => null, watch: () => () => {} }),
};
// lib/utils maps this enum at import time.
export const SighashType = {};
