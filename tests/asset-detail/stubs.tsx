// Stubs for the data hooks and tab bodies of the asset detail screens.
// Knobs from the query string: ledger=1 signs with a Ledger, empty=1 holds
// nothing, tall=1 makes every tab body taller than the popup.
import type { Kcc20Token } from "@/lib/kcc20";

export const OWNER = "kaspa:qowner";
const query = new URLSearchParams(location.search);
const ledger = query.has("ledger");
const empty = query.has("empty");
const tall = query.has("tall");

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
  spendable: empty ? 0n : 1_000_000n,
  meta: { symbol: "KTEST", name: "Kastle test", decimals: 2 },
};

// Wallet and network
export function useWalletManager() {
  return {
    account: { address: OWNER, publicKeys: [] },
    wallet: { type: ledger ? "ledger" : "software" },
    walletSettings: { selectedAccountIndex: 0 },
  };
}
export function useRpcClientStateful() {
  return { rpcClient: {}, networkId: "mainnet" };
}
export function useFeatureFlags() {
  return { isKcc20Enabled: true, isDotkEnabled: true };
}
export function useSettings() {
  return [{ currency: "USD", hideBalances: false }, async () => {}];
}
export const explorerAddressLinks = {
  mainnet: "https://explorer.kaspa.org/addresses/",
};

// Balances
export function useKaspaBalance() {
  return empty ? 0 : 100;
}
export function useTokenInfo(tick?: string) {
  return {
    data: tick
      ? { result: [{ tick, name: tick, dec: "8", mod: "mint" }] }
      : undefined,
  };
}
export function useTokenBalance() {
  return {
    data: { result: [{ balance: empty ? "0" : "100000000000", dec: "8" }] },
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
  return { data: { balance: empty ? "0" : "1000" } };
}
export function useEvmKasBalance() {
  return { data: { balance: empty ? "0" : "1000" } };
}
export function useKcc20Tokens() {
  return { data: [kcc20Token], isLoading: false };
}
export function useDotkName() {
  return {
    lookup: {
      kind: "active",
      // empty=1: someone else owns the name, so there is nothing to send.
      resolved: {
        address: empty ? "kaspa:qsomeoneelse" : OWNER,
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
