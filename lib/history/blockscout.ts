// EVM adapter for the shared History shell: one Blockscout v2 client for every
// L2 that carries an `apiUrl` in lib/layer2, plus the mappers from its address
// transactions and token transfers to HistoryRecord. Kasplex and Igra run the
// same API, so the chain only picks the base URL.

import { findChainByHexId } from "@/lib/layer2";
import { textEllipsis } from "@/lib/utils";
import type {
  HistoryDirection,
  HistoryFamily,
  HistoryKind,
  HistoryRecord,
  HistoryStatus,
  Q,
} from "@/lib/history/types";
import { approxFiat } from "@/lib/history/fiat";

const UNAVAILABLE = { value: null, quality: "unavailable" } as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function exact<T>(value: T): Q<T> {
  return { value, quality: "exact" };
}

type BlockscoutAddress = { hash: string } | null;

export interface BlockscoutTx {
  hash: string;
  timestamp: string | null;
  from: BlockscoutAddress;
  to: BlockscoutAddress;
  value: string;
  fee: { type: string; value: string } | null;
  /** "ok" | "error", null while pending. */
  status: string | null;
  /** "success", "pending", or the revert reason. */
  result: string;
}

export interface BlockscoutTokenTransfer {
  transaction_hash: string;
  log_index: number;
  timestamp: string | null;
  from: BlockscoutAddress;
  to: BlockscoutAddress;
  token: {
    address_hash: string;
    symbol: string | null;
    decimals: string | null;
    type: string;
  };
  total:
    | { decimals: string | null; value: string }
    | { token_id: string | null }
    | null;
}

export type BlockscoutPageParams = Record<string, string | number | null>;

export interface BlockscoutPage<T> {
  items: T[];
  next_page_params: BlockscoutPageParams | null;
}

/**
 * What one History list reads: the chain's native coin, or one ERC-20 contract.
 * An ERC-721 list needs its own source (and endpoint) when a screen asks for it.
 */
export type BlockscoutSource =
  | { family: "evm-native" }
  | { family: "erc20"; token: string };

/** The chain's Blockscout API base, or null when the chain has none. */
export function blockscoutApiBase(chainId?: string): string | null {
  const chain = findChainByHexId(chainId);
  if (!chain || !("apiUrl" in chain) || !chain.apiUrl) return null;
  return chain.apiUrl.replace(/\/+$/, "");
}

/** The URL for one page; `cursor` is the previous page's next_page_params. */
export function blockscoutPageUrl(
  base: string,
  address: string,
  source: BlockscoutSource,
  cursor: BlockscoutPageParams | null,
): string {
  const query = new URLSearchParams();
  if (source.family === "erc20") {
    query.set("type", "ERC-20");
    query.set("token", source.token);
  }
  // The API pages at its own fixed size; it rejects a page_size param.
  for (const [key, value] of Object.entries(cursor ?? {})) {
    if (value !== null) query.set(key, String(value));
  }
  const qs = query.toString();
  const tail = qs ? `?${qs}` : "";
  const path =
    source.family === "evm-native" ? "transactions" : "token-transfers";
  return `${base}/api/v2/addresses/${address}/${path}${tail}`;
}

/**
 * The useSWRInfinite key: page 0, then each next_page_params until the API
 * stops handing one back. Null (no fetch at all) for an unsupported chain.
 */
export function blockscoutPageKey(
  chainId: string | undefined,
  address: string | undefined,
  source: BlockscoutSource,
) {
  const base = blockscoutApiBase(chainId);
  return (
    index: number,
    previous: BlockscoutPage<unknown> | null,
  ): string | null => {
    if (!base || !address) return null;
    if (index === 0) return blockscoutPageUrl(base, address, source, null);
    if (!previous?.next_page_params) return null;
    return blockscoutPageUrl(base, address, source, previous.next_page_params);
  };
}

export async function fetchBlockscoutPage<T>(
  url: string,
): Promise<BlockscoutPage<T>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Explorer answered ${response.status}`);
  }
  return response.json();
}

function same(a: string | undefined, b: string) {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

function timeOf(timestamp: string | null): Q<number> {
  const ms = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(ms) ? exact(ms) : UNAVAILABLE;
}

function directionOf(
  from: string | undefined,
  to: string | undefined,
  owner: string,
): HistoryDirection {
  const out = same(from, owner);
  const into = same(to, owner);
  if (out && into) return "self";
  return out ? "out" : "in";
}

function kindOf(direction: HistoryDirection): HistoryKind {
  if (direction === "self") return "self";
  return direction === "out" ? "send" : "receive";
}

function counterpartyOf(
  direction: HistoryDirection,
  from: string | undefined,
  to: string | undefined,
  owner: string,
  label?: string,
): HistoryRecord["counterparty"] {
  const address = direction === "out" ? to : direction === "in" ? from : owner;
  if (!address) return UNAVAILABLE;
  return exact({ address, label: label ?? textEllipsis(address) });
}

function statusOf(tx: BlockscoutTx): HistoryStatus {
  if (tx.status === "ok") return "finalized";
  // A reverted tx can still read "awaiting_internal_transactions" in `result`.
  if (tx.status === "error") return "failed";
  if (tx.status === null || tx.result === "pending") return "pending";
  return "unknown";
}

function explorerOf(hash: string, chainId: string) {
  // EVM families name the explorer from chainId alone.
  const chain = findChainByHexId(chainId);
  if (!chain) return null;
  const base = chain.blockExplorers.default.url.replace(/\/+$/, "");
  return { url: `${base}/tx/${hash}` };
}

/**
 * A native row claims a coin transfer. A zero-value call (a token transfer, an
 * approval, a swap) moved no coin, so it is dropped rather than shown as
 * "Sent 0"; a contract creation stays, as a deploy without an amount.
 */
export function isNativeTransfer(tx: BlockscoutTx): boolean {
  return !tx.to?.hash || BigInt(tx.value || "0") !== 0n;
}

/**
 * A token row claims a movement too. A zero-value transfer needs no allowance
 * (anyone can emit `transferFrom(you, lookalike, 0)`), so it is the address
 * poisoning vector: dropped, never shown as "Sent 0". A transfer without a
 * value total (an NFT id, or no total at all) is kept.
 */
export function isValueMove(transfer: BlockscoutTokenTransfer): boolean {
  const total = transfer.total;
  if (!total || !("value" in total)) return true;
  try {
    return BigInt(total.value || "0") !== 0n;
  } catch {
    return true;
  }
}

export function blockscoutTxToHistoryRecord(
  tx: BlockscoutTx,
  owner: string,
  chainId: string,
  opts: { usdPrice?: number } = {},
): HistoryRecord {
  const from = tx.from?.hash;
  const to = tx.to?.hash;
  const symbol = findChainByHexId(chainId)?.nativeCurrency.symbol ?? "KAS";
  // No `to` is a contract creation: there is no counterparty to show.
  const deploy = !to && same(from, owner);
  const direction = deploy ? "out" : directionOf(from, to, owner);
  const moved = BigInt(tx.value || "0") !== 0n;

  return {
    id: tx.hash,
    family: "evm-native",
    txid: tx.hash,
    kind: deploy ? "deploy" : kindOf(direction),
    direction,
    amount: moved
      ? exact({ raw: tx.value, decimals: 18, symbol })
      : UNAVAILABLE,
    kasLeg: UNAVAILABLE,
    fiat: moved ? approxFiat(tx.value, 18, opts.usdPrice) : UNAVAILABLE,
    time: timeOf(tx.timestamp),
    counterparty: deploy
      ? UNAVAILABLE
      : counterpartyOf(direction, from, to, owner),
    // Pending txs report fee.type "maximum": a cap, not the fee paid.
    fee: tx.fee
      ? {
          value: { raw: tx.fee.value, symbol },
          quality: tx.fee.type === "actual" ? "exact" : "approximate",
        }
      : UNAVAILABLE,
    status: statusOf(tx),
    explorer: explorerOf(tx.hash, chainId),
  };
}

export function blockscoutTransferToHistoryRecord(
  transfer: BlockscoutTokenTransfer,
  owner: string,
  chainId: string,
  opts: { usdPrice?: number } = {},
): HistoryRecord {
  const family: HistoryFamily =
    transfer.token.type === "ERC-721" ? "erc721" : "erc20";
  const from = transfer.from?.hash;
  const to = transfer.to?.hash;
  const direction = directionOf(from, to, owner);
  const minted = direction === "in" && same(from, ZERO_ADDRESS);
  const symbol = transfer.token.symbol ?? "";
  const total = transfer.total;

  let amount: HistoryRecord["amount"] = UNAVAILABLE;
  // ERC-721 has no price: its fiat stays unavailable.
  let fiat: HistoryRecord["fiat"] = UNAVAILABLE;
  let label: string | undefined;
  if (family === "erc721") {
    const tokenId = total && "token_id" in total ? total.token_id : null;
    amount = exact({ raw: "1", decimals: 0, symbol });
    if (tokenId !== null) {
      const party = direction === "out" ? to : from;
      label = `#${tokenId}${party ? ` · ${textEllipsis(party)}` : ""}`;
    }
  } else if (total && "value" in total) {
    const decimals = total.decimals ?? transfer.token.decimals;
    if (decimals !== null && decimals !== undefined) {
      amount = exact({ raw: total.value, decimals: Number(decimals), symbol });
      fiat = approxFiat(total.value, decimals, opts.usdPrice);
    }
  }

  return {
    id: `${transfer.transaction_hash}:${transfer.log_index}`,
    family,
    txid: transfer.transaction_hash,
    kind: minted ? "mint" : kindOf(direction),
    direction,
    amount,
    kasLeg: UNAVAILABLE,
    fiat,
    time: timeOf(transfer.timestamp),
    counterparty: counterpartyOf(direction, from, to, owner, label),
    // The transfer row carries no fee; the tx it sits in is not fetched.
    fee: UNAVAILABLE,
    // A transfer is an emitted log, and a reverted tx emits none.
    status: "finalized",
    explorer: explorerOf(transfer.transaction_hash, chainId),
  };
}
