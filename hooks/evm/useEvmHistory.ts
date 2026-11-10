import { useCallback, useEffect, useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import {
  blockscoutApiBase,
  blockscoutPageKey,
  blockscoutTransferToHistoryRecord,
  blockscoutTxToHistoryRecord,
  fetchBlockscoutPage,
  isNativeTransfer,
  matchesSource,
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
  const { chainId, address, source } = opts;

  const unavailable = !blockscoutApiBase(chainId)
    ? { reason: "History is not available for this network" }
    : !address
      ? { reason: "History needs an EVM address on this account" }
      : null;

  // The key returns null for an unsupported chain or a missing address, so
  // nothing is fetched in either case.
  const { data, error, size, setSize, mutate } = useSWRInfinite<
    BlockscoutPage<Item>,
    Error
  >(blockscoutPageKey(chainId, address, source), fetchBlockscoutPage<Item>, {
    revalidateFirstPage: false,
  });

  const tokenId = source.family === "erc721" ? source.tokenId : undefined;
  const records = useMemo(() => {
    if (!data || !address || !chainId) return [];
    return data.flatMap((page) => {
      const items = page?.items ?? [];
      if (source.family === "evm-native") {
        return (items as BlockscoutTx[])
          .filter(isNativeTransfer)
          .map((tx) => blockscoutTxToHistoryRecord(tx, address, chainId));
      }
      return (items as BlockscoutTokenTransfer[])
        .filter((t) => matchesSource(t, source, address))
        .map((t) => blockscoutTransferToHistoryRecord(t, address, chainId));
    });
    // `source` is a fresh object each render; key on its contents (a token
    // change also changes the SWR key, so `data` moves with it).
  }, [data, address, chainId, source.family, tokenId]);

  const hasMore = !!data?.[data.length - 1]?.next_page_params;
  const isLoading = !unavailable && !data && !error;
  const isFetchingMore =
    !error && size > 1 && !!data && data[size - 1] === undefined;

  // Backfill: a short first read (the native filter drops zero-value calls)
  // pulls more pages until it holds a screenful, capped at BACKFILL_PAGES.
  // Loop guard: only once the requested pages have all landed, never after an
  // error, never past the cap.
  const loaded = data?.length ?? 0;
  useEffect(() => {
    if (
      !error &&
      hasMore &&
      loaded === size &&
      size < BACKFILL_PAGES &&
      records.length < API_PAGE_SIZE
    ) {
      setSize(size + 1);
    }
  }, [error, hasMore, loaded, size, records.length, setSize]);

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
