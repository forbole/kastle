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
/** How long a request may change nothing before it counts as an empty page. */
const STALL_GRACE_MS = 2000;

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
  // The record captured at click time; the sheet shows its live version from
  // `records`, falling back to the capture only once it has left the list.
  const [selected, setSelected] = useState<HistoryRecord>();
  const close = useCallback(() => setSelected(undefined), []);
  const shown =
    selected && (records.find((r) => r.id === selected.id) ?? selected);

  // React to the state, not the intersection edge: on a page with no rows the
  // sentinel is already in view when the previous load ends, so an
  // intersection change never comes and the list would stall on a spinner.
  const { ref: sentinel, isIntersecting } = useIntersectionObserver({
    threshold: 0.5,
  });
  // Callers pass fresh lambdas each render: read them through refs so a
  // re-render never counts as a reason to load.
  const loadMoreRef = useRef(onLoadMore);
  const retryRef = useRef(onRetry);
  loadMoreRef.current = onLoadMore;
  retryRef.current = onRetry;
  // One request per load cycle: idle → requested (onLoadMore called) →
  // loading (isLoadingMore true) → idle (isLoadingMore false). Pages that add
  // no rows (Blockscout calls that moved no value) keep the sentinel in view:
  // after EMPTY_PAGE_CAP of them in a row, auto-paging stops and a button asks
  // for the next page instead. The streak lives in a ref so the cap engages in
  // the same effect that ends the cycle, before it could request again.
  const phase = useRef<"idle" | "requested" | "loading">("idle");
  const countAtRequest = useRef(0);
  const streak = useRef(0);
  const [emptyStreak, setEmptyStreak] = useState(0);
  const countNow = useRef(records.length);
  countNow.current = records.length;
  // A source that serves a cached page changes no flag and no row, so the
  // gate below would wait in "requested" forever: after a grace period such a
  // request counts as an empty page and the cycle ends.
  const stall = useRef<ReturnType<typeof setTimeout>>();
  const clearStall = () => clearTimeout(stall.current);
  useEffect(() => clearStall, []);
  const request = useCallback(() => {
    phase.current = "requested";
    countAtRequest.current = records.length;
    clearStall();
    stall.current = setTimeout(() => {
      if (
        phase.current !== "requested" ||
        countNow.current !== countAtRequest.current
      )
        return;
      phase.current = "idle";
      streak.current += 1;
      setEmptyStreak(streak.current);
    }, STALL_GRACE_MS);
    loadMoreRef.current();
  }, [records.length]);
  useEffect(() => {
    if (phase.current === "requested" && isLoadingMore) {
      clearStall();
      phase.current = "loading";
    } else if (phase.current === "loading" && !isLoadingMore) {
      phase.current = "idle";
      streak.current =
        records.length > countAtRequest.current ? 0 : streak.current + 1;
      setEmptyStreak(streak.current);
    } else if (
      phase.current === "requested" &&
      (error || !hasMore || records.length !== countAtRequest.current)
    ) {
      clearStall();
      phase.current = "idle";
    }
    if (
      phase.current === "idle" &&
      isIntersecting &&
      hasMore &&
      !isLoadingMore &&
      !error &&
      streak.current < EMPTY_PAGE_CAP
    )
      request();
  });
  const capped = emptyStreak >= EMPTY_PAGE_CAP;
  const retry = () => retryRef.current();

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
            onClick={retry}
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
  // KAS derives hasMore from its last page, undefined while that page loads.
  if (records.length === 0 && !hasMore && !isLoadingMore)
    return <Notice>{emptyMessage}</Notice>;

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
          onClick={retry}
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
          onClick={request}
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
      <ActionSheet isOpen={!!shown} onClose={close}>
        {shown && <HistoryDetail record={shown} onClose={close} />}
      </ActionSheet>
    </div>
  );
}
