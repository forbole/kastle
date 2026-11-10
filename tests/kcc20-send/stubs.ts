// Stubs for the hooks, the KCC-20 builder and the WASM the send screens reach
// into. Scenario knobs come from the page's query string (see main.tsx).
import { useEffect, useState } from "react";
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

// token=<base units> swaps in an 18-decimal balance; unsendable=1 owns no spendable piece;
// kcc20Loading=1 leaves the scan unanswered; unverified=1 marks the metadata claimed;
// decimals=<n> overrides the scale; nometa=1 is a scanned row kascov named nothing for;
// notick=1 / nodecimals=1 drop one half of kascov's claim (partial metadata).
const query = new URLSearchParams(location.search);
const units = query.get("token");
const decimals = query.get("decimals");
const notick = query.has("notick") || query.has("nometa");
export const kcc20Token: Kcc20Token = {
  covenantId: "ab".repeat(32),
  family: "kcc20-standard",
  tick: notick ? "" : "nacho",
  amount: units ? BigInt(units) : 1_000_000n,
  spendable: query.get("unsendable") ? 0n : units ? BigInt(units) : 1_000_000n,
  meta: query.has("nometa")
    ? undefined
    : {
        symbol: notick ? "" : "NACHO",
        name: notick ? "" : "Nacho",
        ...(!query.has("nodecimals") && {
          decimals: decimals ? Number(decimals) : units ? 18 : 2,
        }),
        ...(query.has("unverified") && { unverified: true as const }),
      },
};

// A KRON row as the registry lists it: verified metadata and artwork.
export const kronToken: Kcc20Token = {
  covenantId: "cd".repeat(32),
  family: "kron-legacy",
  tick: "whale",
  amount: 12_800_100_000_000n,
  spendable: 12_800_100_000_000n,
  meta: {
    symbol: "WHALE",
    name: "Whale",
    decimals: 8,
    logoURI:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%2300b1d0'/%3E%3C/svg%3E",
  },
};

// history=1: one exact receive and one row kascov could not attribute; else none.
export function useKcc20History() {
  const entries = query.has("history")
    ? [
        {
          id: "kcc20rx:0",
          txid: "kcc20rx",
          seq: 1,
          kind: "receive",
          amount: 210_759_267_306n,
          ambiguous: false,
          counterparty: "qsender000000000000000000000000",
          acceptingDaa: 2,
          timestampMs: Date.UTC(2026, 0, 2),
          approxTime: true,
        },
        {
          id: "kcc20amb:0",
          txid: "kcc20amb",
          seq: 0,
          kind: "unknown",
          ambiguous: true,
          acceptingDaa: 1,
          timestampMs: Date.UTC(2026, 0, 1),
          approxTime: true,
        },
      ]
    : [];
  return {
    entries,
    size: 1,
    setSize: () => {},
    hasMore: false,
    isLoading: false,
    isLoadingMore: false,
    error: undefined,
    retry: () => {},
    unavailableReason: undefined,
    truncatedReason: undefined,
  };
}

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
// kcc20=off flips the KCC-20 kill switch.
export function useFeatureFlags() {
  const kcc20 = new URLSearchParams(location.search).get("kcc20") !== "off";
  return { isKcc20Enabled: kcc20, isDotkEnabled: false };
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
// hidden=1 masks balances.
const settings = {
  currency: "USD",
  hideBalances: query.get("hidden") === "1",
};
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
  return { fee: 20_000, paymentFee: 20_000, transactionCount: 1 };
}
export function useAnalytics() {
  return {
    emitSendInitiated: () => {},
    emitSendCompleted: () => {},
    emitFirstTransaction: async () => {},
  };
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
// krc20balance=<raw> overrides the KRC-20 balance (base units, dec 8).
export function useTokenBalance() {
  const balance =
    new URLSearchParams(location.search).get("krc20balance") ?? "100000000000";
  return { data: { result: [{ balance, dec: "8" }] } };
}
export function useKrc20Prices() {
  return { price: 0.5 };
}
export function useKrc20Logo() {
  return { logo: undefined };
}
export function useTokenListByAddress() {
  return [{ id: "KASPY", dec: "8", balance: "100000000000" }];
}

// EVM: the picker lists no L2 asset.
export function useErc20Assets() {
  return { assets: [] };
}
export function useEvmKasBalance() {
  return { data: undefined };
}
export function useErc20Balance() {
  return { data: undefined };
}
export function useErc20Image() {
  return { logoUrl: undefined };
}

// KCC-20
// Like the real hook, no address means no fetch.
// price=<usd> prices a KCC-20 token; without it no market lists one.
// kronPrice=<usd> prices the KRON fixture alone.
export function useKcc20Price(token?: Pick<Kcc20Token, "family">) {
  const usd =
    token?.family === "kron-legacy"
      ? query.get("kronPrice")
      : query.get("price");
  return { priceUsd: usd === null ? undefined : Number(usd) };
}
// The real module also exports the KRC-20 display fill, so it is stubbed whole
// (a named-only stub shims the fill to undefined and every KCC-20 row throws).
// ponytail: identity, the fill itself is covered by kcc20-history-attribution-unit.
export function useKrc20FilledToken<T>(token: T): T {
  return token;
}
// kcc20Unsettled=<ms>: SWR's in-between state (no data, isLoading false) for
// that long; the settle time lands in window.__kcc20SettledAt.
export function useKcc20Tokens(address?: string) {
  const unsettledMs = query.get("kcc20Unsettled");
  const [settled, setSettled] = useState(unsettledMs === null);
  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => {
      (window as unknown as { __kcc20SettledAt: number }).__kcc20SettledAt =
        performance.now();
      setSettled(true);
    }, Number(unsettledMs));
    return () => clearTimeout(t);
  }, [settled]);
  if (query.has("kcc20Loading")) return { data: undefined, isLoading: true };
  // kcc20Error=1: the scan rejected (SWR keeps data undefined, sets error).
  if (query.has("kcc20Error"))
    return {
      data: undefined,
      isLoading: false,
      error: new Error("kascov unreachable"),
    };
  if (!settled) return { data: undefined, isLoading: false };
  return { data: address ? [kcc20Token] : undefined, isLoading: false };
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
// Mirrors the real Settings export: kascov's per-transaction page, mainnet only.
export const kcc20TxLinks = { mainnet: "https://kascov.io/#/mainnet/tx/" };
export const explorerAddressLinks = {
  mainnet: "https://explorer.kaspa.org/addresses/",
};

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

// lib/hidden-tokens (via AssetSelect) reads storage.local; the real
// wxt/browser polyfill throws outside an extension. Nothing is hidden here.
export const browser = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
};
