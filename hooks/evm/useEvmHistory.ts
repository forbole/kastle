import { useCallback, useEffect, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import {
  blockscoutApiBase,
  blockscoutPageKey,
  blockscoutTransferToHistoryRecord,
  blockscoutTxToHistoryRecord,
  fetchBlockscoutPage,
  isNativeTransfer,
  isValueMove,
  type BlockscoutPage,
  type BlockscoutSource,
  type BlockscoutTokenTransfer,
  type BlockscoutTx,
} from "@/lib/history/blockscout";
import type { HistoryRecord } from "@/lib/history/types";

/** Blockscout's own fixed page size; never sent, only used to judge "short". */
const API_PAGE_SIZE = 50;
/** Backfill a short list up to this many pages, never more. */
const BACKFILL_PAGES = 3;

type Item = BlockscoutTx | BlockscoutTokenTransfer;

export function useEvmHistory(opts: {
  chainId?: string;
  address?: string;
  source: BlockscoutSource;
  /** The wallet is still loading: the address is not known missing yet. */
  addressPending?: boolean;
  /** Current USD price of one whole coin/token; 0 or absent means no price. */
  usdPrice?: number;
}): {
  records: HistoryRecord[];
  isLoading: boolean;
  error: Error | null;
  /** True when the current read cannot work at all: name why. */
  unavailable: { reason: string } | null;
  hasMore: boolean;
  isFetchingMore: boolean;
  loadMore: () => void;
  retry: () => void;
} {
  const { chainId, address, source, addressPending = false, usdPrice } = opts;

  const { unavailable, waiting } = evmHistoryGate(
    chainId,
    address,
    addressPending,
  );

  // The key returns null for an unsupported chain or a missing address, so
  // nothing is fetched in either case.
  // revalidateFirstPage stays at SWR's default (true): the popup unmounts on
  // close, so a cached first page must refetch on mount and focus, or a
  // transfer just sent never shows on reopen. SWR keeps the old `data` while
  // it refetches, so the rows on screen stay. Cost: each setSize also
  // refetches page 1 (a full backfill is 5 requests, not 3).
  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite<
    BlockscoutPage<Item>,
    Error
  >(blockscoutPageKey(chainId, address, source), fetchBlockscoutPage<Item>);

  const token = source.family === "erc20" ? source.token : undefined;
  const records = useMemo(() => {
    if (!data || !address || !chainId) return [];
    return data.flatMap((page) => {
      const items = page?.items ?? [];
      if (source.family === "evm-native") {
        return (items as BlockscoutTx[])
          .filter(isNativeTransfer)
          .map((tx) =>
            blockscoutTxToHistoryRecord(tx, address, chainId, { usdPrice }),
          );
      }
      return (items as BlockscoutTokenTransfer[])
        .filter(isValueMove)
        .map((t) =>
          blockscoutTransferToHistoryRecord(t, address, chainId, { usdPrice }),
        );
    });
    // `source` is a fresh object each render; key on its contents (a token
    // change also changes the SWR key, so `data` moves with it).
  }, [data, address, chainId, source.family, token, usdPrice]);

  const hasMore = !!data?.[data.length - 1]?.next_page_params;
  const isLoading = waiting || (!unavailable && !data && !error);
  const isFetchingMore =
    !error && size > 1 && !!data && data[size - 1] === undefined;

  // Backfill: a short first read (the native filter drops zero-value calls)
  // pulls more pages until it holds a screenful, capped at BACKFILL_PAGES.
  // Loop guard: only once the requested pages have all landed and nothing is
  // in flight (a revalidating first page means wait, not fetch another page),
  // never after an error, never past the cap.
  const loaded = data?.length ?? 0;
  useEffect(() => {
    if (
      !error &&
      !isValidating &&
      hasMore &&
      loaded === size &&
      size < BACKFILL_PAGES &&
      records.length < API_PAGE_SIZE
    ) {
      setSize(size + 1);
    }
  }, [error, isValidating, hasMore, loaded, size, records.length, setSize]);

  const loadMore = useCallback(() => {
    if (hasMore && !isFetchingMore) setSize((s) => s + 1);
  }, [hasMore, isFetchingMore, setSize]);

  const retry = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    records,
    isLoading,
    error: error ?? null,
    unavailable,
    hasMore,
    isFetchingMore,
    loadMore,
    retry,
  };
}

/**
 * Why the read cannot work (or null), and whether it is waiting on the wallet.
 * While the wallet loads the address is unknown, not missing: report loading,
 * and name "no address" only once loading settles.
 */
export function evmHistoryGate(
  chainId: string | undefined,
  address: string | undefined,
  addressPending = false,
): { unavailable: { reason: string } | null; waiting: boolean } {
  if (!blockscoutApiBase(chainId))
    return {
      unavailable: { reason: "History is not available for this network" },
      waiting: false,
    };
  if (address) return { unavailable: null, waiting: false };
  if (addressPending) return { unavailable: null, waiting: true };
  return {
    unavailable: { reason: "History needs an EVM address on this account" },
    waiting: false,
  };
}
