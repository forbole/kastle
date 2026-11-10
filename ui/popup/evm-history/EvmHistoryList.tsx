import React from "react";
import type { HistoryRecord } from "@/lib/history/types";
import { EvmHistoryRow } from "@/ui/popup/evm-history/EvmHistoryRow";

export interface EvmHistoryListProps {
  records: HistoryRecord[];
  isLoading: boolean;
  error: Error | null;
  unavailable: { reason: string } | null;
  hasMore: boolean;
  isFetchingMore: boolean;
  loadMore: () => void;
  onRetry: () => void;
  /** Display bits the record cannot carry, passed to every row. */
  logo?: string;
  symbol?: string;
  chainImage?: string;
}

const SPINNER =
  "inline-block size-5 animate-spin rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600";

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
      <div className="size-10 rounded-full bg-daintree-700" />
      <div className="flex flex-grow flex-col gap-2">
        <div className="h-3.5 w-1/3 rounded bg-daintree-700" />
        <div className="h-3 w-1/2 rounded bg-daintree-700" />
      </div>
    </div>
  );
}

export function EvmHistoryList({
  records,
  isLoading,
  error,
  unavailable,
  hasMore,
  isFetchingMore,
  loadMore,
  onRetry,
  logo,
  symbol,
  chainImage,
}: EvmHistoryListProps) {
  const centred = "py-8 text-center text-sm text-daintree-400";

  if (unavailable) return <p className={centred}>{unavailable.reason}</p>;

  if (records.length === 0) {
    if (isLoading) {
      return (
        <div className="flex flex-col gap-2" role="status" aria-label="loading">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      );
    }
    if (error) {
      return (
        <div className={`${centred} flex flex-col items-center gap-3`}>
          <span>{error.message}</span>
          <button
            type="button"
            className="rounded-full bg-daintree-700 px-4 py-2 text-sm font-medium text-white hover:bg-daintree-600"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      );
    }
    return <p className={centred}>No history yet</p>;
  }

  // Records arrive newest-first from the API; the order is kept as is.
  return (
    <div className="flex flex-col items-stretch gap-2">
      {records.map((record) => (
        <EvmHistoryRow
          key={record.id}
          record={record}
          logo={logo}
          symbol={symbol}
          chainImage={chainImage}
        />
      ))}
      {error && (
        <p className="text-center text-xs text-red-400">
          {error.message}{" "}
          <button type="button" className="underline" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          className="flex items-center justify-center self-center py-2 text-sm font-medium text-daintree-400 hover:text-white disabled:cursor-default"
          disabled={isFetchingMore}
          onClick={loadMore}
        >
          {isFetchingMore ? (
            <span className={SPINNER} role="status" aria-label="loading" />
          ) : (
            "Load more"
          )}
        </button>
      )}
    </div>
  );
}
