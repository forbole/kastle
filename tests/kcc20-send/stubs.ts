// Stubs for the hooks, the KCC-20 builder and the WASM the send screens reach
// into. Scenario knobs come from the page's query string (see main.tsx).
import type { Kcc20Token } from "@/lib/kcc20";

export const OWNER = "kaspa:qowner";

type Built = { amount: bigint; fee: bigint; kasDebit: bigint };

declare global {
  interface Window {
    __kcc20Send: {
      build: string;
      send: string;
      builds: { recipient: string; amount: string; network?: string }[];
      recent: { kaspaAddress: string; domain?: string }[];
      // Settles a build or send held by build=hold / send=hold.
      release?: () => void;
    };
  }
}

const h = () => window.__kcc20Send;

(window as unknown as { browser: unknown }).browser = {
  tabs: { create: () => {} },
  action: { setPopup: () => {} },
};

const hold = () => new Promise<void>((r) => (h().release = r));

// token=<base units> swaps in an 18-decimal balance.
const units = new URLSearchParams(location.search).get("token");
export const kcc20Token: Kcc20Token = {
  covenantId: "ab".repeat(32),
  family: "kcc20-standard",
  tick: "nacho",
  amount: units ? BigInt(units) : 1_000_000n,
  spendable: units ? BigInt(units) : 1_000_000n,
  meta: { symbol: "NACHO", name: "Nacho", decimals: units ? 18 : 2 },
};

// Wallet and network
export function useWalletManager() {
  return {
    account: { address: OWNER, publicKeys: [] },
    wallet: { type: "software" },
    walletSettings: { selectedAccountIndex: 0 },
  };
}
export function useRpcClientStateful() {
  return { rpcClient: {}, networkId: "mainnet" };
}
export function useKaspaHotWalletSigner() {
  return {};
}
export function useKaspaBalance() {
  return 100;
}
export function useFeatureFlags() {
  return { isKcc20Enabled: true, isDotkEnabled: false };
}
export function useRecentAddresses() {
  return {
    recentAddresses: [],
    addRecentAddress: async (a: { kaspaAddress: string; domain?: string }) => {
      h().recent.push({ kaspaAddress: a.kaspaAddress, domain: a.domain });
    },
  };
}

// Prices and fees
const settings = { currency: "USD", hideBalances: false };
export function useSettings() {
  return [settings, async () => {}];
}
export function useKaspaPrice() {
  return { kaspaPrice: 0.1 };
}
export function useCurrencyValue(usd: number) {
  return { amount: usd, code: "USD" };
}
export function useMempoolStatus() {
  return { mempoolCongestionLevel: "low" };
}
export function usePriorityFeeEstimate() {
  return undefined;
}
export function useKasFeeEstimate() {
  return { fee: 20_000 };
}
export function useAnalytics() {
  return { emitSendCompleted: () => {}, emitFirstTransaction: async () => {} };
}

// Names: any kaspa: address resolves to itself, "bob.kas" to a fixed one.
export function useKns() {
  return { fetchDomainInfo: async () => undefined };
}
export function useResolveRecipient() {
  return async (input: string) => {
    if (input === "bob.kas") return { address: "kaspa:qbob", domain: input };
    return input.startsWith("kaspa:q") && input.length > 8
      ? { address: input }
      : { fault: undefined };
  };
}

// KRC-20
export function useTokenInfo(tick?: string) {
  return {
    data: tick
      ? { result: [{ tick, name: tick, dec: "8", mod: "mint" }] }
      : undefined,
    isLoading: false,
  };
}
export function useTokenBalance() {
  return { data: { result: [{ balance: "100000000000", dec: "8" }] } };
}
export function useKrc20Prices() {
  return { price: 0.5 };
}
export function useKrc20Logo() {
  return { logo: undefined };
}

// KCC-20
export function useKcc20Tokens() {
  return { data: [kcc20Token], isLoading: false };
}

// Copy of lib/kcc20's guard: the real module pulls the KRON SDK.
export function decimalsError(input: string, decimals: number, symbol: string) {
  if ((input.trim().split(".")[1]?.length ?? 0) <= decimals) return undefined;
  return decimals === 0
    ? `${symbol} has no decimal places`
    : `${symbol} has at most ${decimals} decimal places`;
}

export class Kcc20TransferError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class Kcc20StandardBuildError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export async function buildKcc20Transfer(args: {
  recipient: string;
  amount: bigint;
  network?: string;
}): Promise<Built> {
  h().builds.push({
    recipient: args.recipient,
    amount: String(args.amount),
    network: args.network,
  });
  if (h().build === "hold") await hold();
  if (h().build === "error")
    throw new Kcc20StandardBuildError("insufficient-balance");
  if (h().build === "recipient")
    throw new Kcc20TransferError(
      "invalid-recipient",
      "Recipient must be a Schnorr address",
    );
  return { amount: args.amount, fee: 12_345n, kasDebit: 112_345n };
}
export async function sendKcc20Transfer() {
  if (h().send === "hold") await hold();
  if (h().send === "error") throw new Error("node rejected the transaction");
  return "kcc20tx";
}

export const explorerTxLinks = { mainnet: "https://explorer.kaspa.org/txs/" };

// WASM: the screens only format sompi and build a script they catch failing.
export class PublicKey {
  constructor() {
    throw new Error("no wasm in the harness");
  }
}
export function sompiToKaspaString(sompi: bigint | number) {
  return (Number(sompi) / 1e8).toString();
}

// Extension plumbing
export const Method = {};
export const captureException = () => {};
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
  watch: () => () => {},
  defineItem: () => ({ getValue: async () => null, watch: () => () => {} }),
};
// lib/utils maps this enum at import time.
export const SighashType = {};
