// Data sources behind the four history surfaces, each answering the same six
// row shapes: out, in, self, no amount, no time, counterparty unavailable.
// A shape the source cannot produce is named where it would go.
// Knob from the query string:
//   state=empty    one page, no rows, nothing left
//   state=more     no rows yet, another page remains, nothing in flight
//   state=loading  page 1 in flight
//   state=pager    KRC-20 only: every page loads (isValidating) and adds no
//                  rows, another always remains; window.__pagesRequested counts
//   state=stall    EVM only: loadMore serves a cached page — no flag, no row
//                  changes; window.__pagesRequested counts
//   state=refresh  KAS only: row 0 starts pending; window.__finalize() lands
//                  the refresh that finalizes it
import { useState } from "react";
import type { KaspaTxHistoryItem } from "@/hooks/useKasTxHistory";
import type { Op } from "@/hooks/useOpListByAddressAndTicker";
import type { Kcc20HistoryEntry } from "@/lib/kcc20/history";
import {
  blockscoutTxToHistoryRecord,
  type BlockscoutTx,
} from "@/lib/history/blockscout";
import {
  EVM_CHAIN,
  EVM_OWNER,
  EVM_TOKEN,
  EVM_TOKEN_LOGO,
  OWNER,
} from "./constants";

export { EVM_CHAIN, EVM_OWNER, EVM_TOKEN, EVM_TOKEN_LOGO, OWNER };

const state = new URLSearchParams(location.search).get("state");
const empty = state === "empty" || state === "more";
const loading = state === "loading";
const more = state === "more";
const noop = () => {};

const ALICE = "kaspa:qalice";
const BOB = "kaspa:qbob";
const T = Date.UTC(2026, 0, 2, 3, 4);
const hash = (n: number) => n.toString(16).padStart(64, "0");

// Extension plumbing
(window as unknown as { browser: unknown }).browser = {
  tabs: { create: noop },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
export const browser = (window as unknown as { browser: unknown }).browser;
export const captureException = noop;
export const storage = {
  getItem: async () => null,
  setItem: async () => {},
  watch: () => noop,
  defineItem: () => ({ getValue: async () => null, watch: () => noop }),
};
export const SighashType = {};
export const explorerTxLinks: Record<string, string> = {
  mainnet: "https://explorer.test/txs/",
};
export const kcc20TxLinks: Record<string, string> = {
  mainnet: "https://kascov.io/#/mainnet/tx/",
};

// Wallet, network, prices
export function useWalletManager() {
  return { account: { address: OWNER, publicKeys: [] } };
}
export function useRpcClientStateful() {
  return { rpcClient: {}, networkId: "mainnet" };
}
export function useSettings() {
  return [{ currency: "USD", networkId: "mainnet" }, async () => {}];
}
export function useFeatureFlags() {
  return { isKcc20Enabled: true, isKcc20StandardEnabled: true };
}
// KAS has a price, so its sheet shows Value; KRC-20 does not.
export function useKaspaPrice() {
  return { kaspaPrice: 0.1 };
}
export function useKrc20Prices() {
  return { price: 0 };
}
export function useCurrencyValue(amount: number) {
  return { amount, code: "USD" };
}
export function useTokenInfo(tick?: string) {
  return { data: tick ? { result: [{ tick, dec: "8" }] } : undefined };
}

// KAS: the adapter nets own inputs against own outputs, so every tx carries an
// amount; "no amount" cannot happen. The self row shows its own outputs (100 KAS).
const kas = (
  n: number,
  inputs: [string, number][],
  outputs: [string, number][],
  timeMs: number | null = T - n * 3_600_000,
): KaspaTxHistoryItem => ({
  txHash: hash(n),
  inputs: inputs.map(([address, kas]) => ({ address, amount: kas * 1e8 })),
  outputs: outputs.map(([address, kas]) => ({ address, amount: kas * 1e8 })),
  timeMs,
  isAccepted: true,
});
const KAS_TXS = [
  kas(
    1,
    [[OWNER, 1000]],
    [
      [ALICE, 250],
      [OWNER, 750],
    ],
  ), // out
  kas(
    2,
    [[BOB, 500]],
    [
      [OWNER, 100],
      [BOB, 400],
    ],
  ), // in
  kas(3, [[OWNER, 100]], [[OWNER, 100]]), // self
  kas(4, [[BOB, 5]], [[OWNER, 5]], null), // no time
  kas(
    5,
    [[OWNER, 100]],
    [
      [ALICE, 10],
      [BOB, 20],
      [OWNER, 70],
    ],
  ), // no party
];
const kasWindow = window as unknown as { __finalize: () => void };
export function useKasTxHistory() {
  const [accepted, setAccepted] = useState(state !== "refresh");
  kasWindow.__finalize = () => setAccepted(true);
  const txs = accepted
    ? KAS_TXS
    : [{ ...KAS_TXS[0], isAccepted: false }, ...KAS_TXS.slice(1)];
  return {
    txs: empty || loading ? [] : txs,
    error: undefined,
    isLoading: loading,
    isLoadingMore: false,
    hasNextPage: more,
    loadMore: noop,
    mutate: noop,
  };
}

// KRC-20: Kasplex oplist pages.
const op = (n: number, o: Partial<Op>): Op => ({
  p: "krc-20",
  op: "transfer",
  tick: "KASPY",
  amt: "100000000",
  pre: "",
  from: OWNER,
  to: ALICE,
  opScore: String(n),
  hashRev: hash(100 + n),
  feeRev: "0",
  txAccept: "1",
  opAccept: "1",
  opError: "",
  checkpoint: "",
  mtsAdd: String(T - n * 3_600_000),
  mtsMod: "",
  ...o,
});
const OPS = [
  op(1, {}), // out
  op(2, { from: BOB, to: OWNER, amt: "250000000" }), // in
  op(3, { to: OWNER }), // self
  op(4, { from: BOB, to: OWNER, amt: "" }), // no amount
  op(5, { from: BOB, to: OWNER, mtsAdd: "" }), // no time
  // No recipient and no hash: no counterparty, no TX ID, no explorer.
  op(6, { to: undefined, hashRev: "" }),
];
const pagesWindow = window as unknown as { __pagesRequested: number };
pagesWindow.__pagesRequested = 0;

function usePagerOpList() {
  const [size, setSize] = useState(1);
  const [validating, setValidating] = useState(false);
  return {
    data: Array.from({ length: size }, () => ({ result: [], next: "p" })),
    setSize: (next: (n: number) => number) => {
      pagesWindow.__pagesRequested += 1;
      setValidating(true);
      setTimeout(() => {
        setSize(next);
        setValidating(false);
      }, 30);
    },
    isLoading: false,
    isValidating: validating,
    error: undefined,
    mutate: noop,
  };
}

export function useOpListByAddressAndTicker() {
  const pager = usePagerOpList();
  if (state === "pager") return pager;
  return {
    data: loading
      ? undefined
      : [{ result: empty ? [] : OPS, ...(more && { next: "p2" }) }],
    setSize: noop,
    isLoading: loading,
    isValidating: loading,
    error: undefined,
    mutate: noop,
  };
}

// KCC-20: kascov entries. Every entry carries a DAA-derived time, so "no time"
// cannot happen.
const entry = (
  n: number,
  kind: Kcc20HistoryEntry["kind"],
  amount?: bigint,
  counterparty?: string,
): Kcc20HistoryEntry => ({
  id: `kcc20:${n}`,
  txid: hash(200 + n),
  seq: 0,
  kind,
  ...(amount !== undefined && { amount }),
  ambiguous: false,
  ...(counterparty && { counterparty }),
  acceptingDaa: n,
  timestampMs: T - n * 3_600_000,
  approxTime: true,
});
const ENTRIES = [
  entry(1, "send", 250n, "p2pkh:qrecipient"), // out
  entry(2, "receive", 100n, "p2pkh:qsender"), // in
  entry(3, "self", 50n), // self
  entry(4, "send", undefined, "p2pkh:qnoamount"), // no amount
  entry(6, "receive", 70n), // no party
];
export function useKcc20History() {
  return {
    entries: empty || loading ? [] : ENTRIES,
    size: 1,
    setSize: noop,
    hasMore: more,
    isLoading: loading,
    isLoadingMore: false,
    error: undefined,
    retry: noop,
    unavailableReason: undefined,
    truncatedReason: undefined,
  };
}

// EVM: Blockscout txs on Kasplex L2, run through the real mapper.
const EVM_OTHER = "0x2222222222222222222222222222222222222222";
const tx = (n: number, o: Partial<BlockscoutTx>): BlockscoutTx =>
  ({
    hash: `0x${hash(300 + n)}`,
    from: { hash: EVM_OWNER },
    to: { hash: EVM_OTHER },
    value: "1500000000000000000",
    fee: { type: "actual", value: "21000000000000" },
    status: "ok",
    result: "success",
    timestamp: new Date(T - n * 3_600_000).toISOString(),
    ...o,
  }) as BlockscoutTx;
const EVM_TXS = [
  tx(1, {}), // out
  tx(2, { from: { hash: EVM_OTHER }, to: { hash: EVM_OWNER } }), // in
  tx(3, { to: { hash: EVM_OWNER }, value: "500000000000000000" }), // self
  tx(4, { to: null, value: "0" }), // no amount: a contract deploy
  tx(5, {
    from: { hash: EVM_OTHER },
    to: { hash: EVM_OWNER },
    timestamp: null,
  }), // no time
  tx(6, { from: null, to: { hash: EVM_OWNER } }), // no party
] as BlockscoutTx[];
export function useEvmHistory({
  chainId,
  address,
}: {
  chainId?: string;
  address?: string;
}) {
  return {
    records:
      empty || loading || !chainId || !address
        ? []
        : EVM_TXS.map((t) => blockscoutTxToHistoryRecord(t, address, chainId)),
    isLoading: loading,
    error: null,
    unavailable: null,
    hasMore: more || state === "stall",
    isFetchingMore: false,
    loadMore: () => (pagesWindow.__pagesRequested += 1),
    retry: noop,
  };
}

// Beside the EVM screens: their owner address, balances and token metadata.
export function useEvmAddress() {
  return EVM_OWNER;
}
export function useEvmKasBalance() {
  return { data: { balance: "0" } };
}
export function useErc20Info() {
  return { symbol: "TKN", image: EVM_TOKEN_LOGO };
}
export function useErc20Balance() {
  return { data: { balance: "0" } };
}
export function useErc20Image() {
  return { logoUrl: undefined };
}
// The same shim also feeds Erc20Info (the Info tab) its price.
export function useErc20Price() {
  return { price: 0 };
}
