import { useCallback, useEffect, useRef, useState } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import type { HistoryRecord } from "@/lib/history/types";
import ActionSheet from "@/ui/general/ActionSheet";
import { HistoryDetail } from "@/ui/popup/history/HistoryDetail";
import { HistoryRow } from "@/ui/popup/history/HistoryRow";

export interface HistoryListProps {
  records: HistoryRecord[];
  /** Page 1 in flight with nothing landed. */
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Replaces the list entirely. */
  unavailableMessage?: string;
  emptyMessage?: string;
  truncatedMessage?: string;
}

function Spinner() {
  return (
    <div
      className="inline-block size-6 animate-spin self-center rounded-full border-[3px] border-current border-t-icy-blue-400 text-icy-blue-600"
      role="status"
      aria-label="loading"
    />
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-daintree-700 bg-daintree-800 p-4 text-center text-sm text-daintree-400">
      {children}
    </div>
  );
}

const EMPTY_PAGE_CAP = 3;

/**
 * The one history shell every family renders, paged as the sentinel scrolls in.
 * Renders inside the page's scroll body: no height of its own.
 */
export function HistoryList({
  records,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  unavailableMessage,
  emptyMessage = "No history yet.",
  truncatedMessage,
}: HistoryListProps): React.ReactElement {
  const [selected, setSelected] = useState<HistoryRecord>();
  const close = useCallback(() => setSelected(undefined), []);

  // React to the state, not the transition: on a page with no rows the
  // sentinel is already in view when the previous load ends, so an
  // intersection change never comes and the list would stall on a spinner.
  const { ref: sentinel, isIntersecting } = useIntersectionObserver({
    threshold: 0.5,
  });
  // Pages that add no rows (Blockscout calls that moved no value) keep the
  // sentinel in view: after EMPTY_PAGE_CAP of them in a row, auto-paging
  // stops and a button asks for the next page instead.
  const [emptyStreak, setEmptyStreak] = useState(0);
  const countAtRequest = useRef<number>();
  useEffect(() => {
    if (isLoadingMore) {
      countAtRequest.current = records.length;
    } else if (countAtRequest.current !== undefined) {
      const grew = records.length > countAtRequest.current;
      countAtRequest.current = undefined;
      setEmptyStreak((n) => (grew ? 0 : n + 1));
    }
    // Only the load's edges matter, not every records change.
  }, [isLoadingMore]);
  const capped = emptyStreak >= EMPTY_PAGE_CAP;
  useEffect(() => {
    if (isIntersecting && hasMore && !isLoadingMore && !error && !capped)
      onLoadMore();
  }, [isIntersecting, hasMore, isLoadingMore, error, capped, onLoadMore]);

  // State order is fixed: each check assumes every one above it failed.
  if (unavailableMessage) return <Notice>{unavailableMessage}</Notice>;

  // Page 1 failed: nothing to show but the way back.
  if (error && records.length === 0)
    return (
      <Notice>
        <div className="flex flex-col items-center gap-3">
          <span>Could not load history.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-daintree-700 px-4 py-1.5 text-white hover:border-white"
          >
            Retry
          </button>
        </div>
      </Notice>
    );

  if (isLoading) return <Spinner />;

  // A page may hold nothing of this wallet's and still have pages after it:
  // empty means empty only once the query has none left.
  if (records.length === 0 && !hasMore) return <Notice>{emptyMessage}</Notice>;

  return (
    <div className="flex flex-col items-stretch gap-2">
      {records.map((record) => (
        <HistoryRow
          key={record.id}
          record={record}
          onClick={() => setSelected(record)}
        />
      ))}
      {error ? (
        <button
          type="button"
          onClick={onRetry}
          className="self-center rounded-full border border-daintree-700 px-4 py-1.5 text-sm text-white hover:border-white"
        >
          Retry
        </button>
      ) : capped && hasMore && !isLoadingMore ? (
        <button
          type="button"
          // The streak stays put: an empty page keeps the button, a page
          // with rows resets it and auto-paging resumes. Touching it here
          // would let the sentinel fire a second page before this one starts.
          onClick={onLoadMore}
          className="self-center py-2 text-sm font-medium text-daintree-400 hover:text-white"
        >
          Load more
        </button>
      ) : (
        // records.length === 0 here means hasMore: state 5, a spinner, with the
        // sentinel kept mounted so the next page still loads.
        (isLoadingMore || records.length === 0) && <Spinner />
      )}
      {truncatedMessage && records.length > 0 && (
        <p className="text-center text-sm text-daintree-400">
          {truncatedMessage}
        </p>
      )}
      {/* A zero-height sentinel sits a subpixel past the scroll body's edge and never fires. */}
      <div ref={sentinel} className="h-1 shrink-0" />
      <ActionSheet isOpen={!!selected} onClose={close}>
        {selected && <HistoryDetail record={selected} onClose={close} />}
      </ActionSheet>
    </div>
  );
}
