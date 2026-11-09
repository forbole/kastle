import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import { useIntersectionObserver } from "usehooks-ts";
import { explorerTxLinks } from "@/components/screens/Settings";
import { NetworkType } from "@/contexts/SettingsContext";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import type { Kcc20Token } from "@/lib/kcc20";
import { Kcc20HistoryRow, toHistoryRow } from "@/lib/kcc20/history";
import {
  Kcc20HistoryTruncated,
  Kcc20HistoryUnavailable,
  useKcc20History,
} from "@/lib/kcc20/useKcc20History";
import { textEllipsis } from "@/lib/utils";
import ActionSheet from "@/ui/general/ActionSheet";
import { formatKcc20Amount } from "@/ui/popup/kcc20/labels";

const UNAVAILABLE: Record<Kcc20HistoryUnavailable, string> = {
  network: "History is shown on mainnet only.",
  disabled: "History is not enabled on this device yet.",
  wallet: "History needs a standard Kaspa (Schnorr) address.",
  family: "History is not supported for this token type.",
};

const TRUNCATED: Record<Kcc20HistoryTruncated, string> = {
  "events-cap": "Older history is not shown.",
};

// Mobile's history labels.
const KIND_LABEL: Record<Kcc20HistoryRow["kind"], string> = {
  receive: "Received",
  send: "Sent",
  self: "Self transfer",
  buy: "Bought",
  sell: "Sold",
  unknown: "Unattributed movement",
};

const DIRECTION_ICON: Record<
  Kcc20HistoryRow["direction"],
  typeof ArrowUpRight
> = {
  in: ArrowDownLeft,
  out: ArrowUpRight,
  self: ArrowLeftRight,
};

const timeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
// A date is exact: "≈" belongs to estimated fiat values, never to a timestamp.
const formatTime = (ms: number) => timeFormat.format(new Date(ms));

type TokenView = { symbol: string; decimals?: number; logo?: string };

/** A row as the detail sheet reads it; `status` renders only when a feed supplies it. */
export type Kcc20HistoryDetailRow = Kcc20HistoryRow & { status?: string };

// Signed; absent when kascov could not attribute it. Unknown decimals read as base units.
function amountLabel(row: Kcc20HistoryRow, token: TokenView) {
  if (row.amount === undefined) return;
  const sign =
    row.direction === "in" ? "+" : row.direction === "out" ? "-" : "";
  const value = formatKcc20Amount(row.amount, token.decimals);
  return token.decimals === undefined
    ? `${sign}${value}`
    : `${sign}${value} ${token.symbol}`;
}

// As mobile: "From"/"To" the other side; a self row has none.
function counterpartyText(row: Kcc20HistoryRow) {
  if (!row.counterparty || row.direction === "self") return;
  return `${row.direction === "in" ? "From" : "To"} ${row.counterparty.label}`;
}

// Movement colour: in and out only; self and unattributed stay neutral.
function movementTone(row: Kcc20HistoryRow) {
  if (row.kind === "unknown" || row.direction === "self") return "text-white";
  return row.direction === "out" ? "text-red-500" : "text-teal-500";
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

// Mobile's row: direction, what happened, who with; amount and time on the right.
function Kcc20HistoryItem({
  row,
  token,
  onClick,
}: {
  row: Kcc20HistoryRow;
  token: TokenView;
  onClick: () => void;
}) {
  const amount = amountLabel(row, token);
  const counterparty = counterpartyText(row);
  const Icon =
    row.kind === "unknown" ? HelpCircle : DIRECTION_ICON[row.direction];

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white"
    >
      <span
        aria-hidden="true"
        className={twMerge(
          "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5",
          movementTone(row),
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <span className="truncate text-base text-white">
          {KIND_LABEL[row.kind]}
        </span>
        {counterparty && (
          <span className="truncate text-sm text-daintree-400">
            {counterparty}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {amount && (
          <span className={twMerge("text-base", movementTone(row))}>
            {amount}
          </span>
        )}
        <span className="text-sm text-daintree-400">
          {formatTime(row.timeMs)}
        </span>
      </div>
    </button>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-daintree-700 py-3 text-sm last:border-b-0">
      <span className="shrink-0 text-daintree-400">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2 text-right text-white">
        {children}
      </div>
    </div>
  );
}

function CopyTxId({ txid }: { txid: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <>
      <button
        type="button"
        aria-label="Copy TX ID"
        onClick={() =>
          navigator.clipboard.writeText(txid).then(() => setCopied(true))
        }
        className="shrink-0 text-daintree-400 hover:text-white"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? "TX ID copied" : ""}
      </span>
    </>
  );
}

const FOCUSABLE =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Mobile's activity sheet: TX Hash, the time, Status when known, TX ID, explorer. */
export function Kcc20HistoryDetail({
  row,
  onClose,
}: {
  row: Kcc20HistoryDetailRow;
  onClose: () => void;
}) {
  const { networkId } = useRpcClientStateful();
  const explorer = explorerTxLinks[networkId ?? NetworkType.Mainnet];
  const root = useRef<HTMLDivElement>(null);

  // The sheet holds focus while open, Escape closes it, and focus returns on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !root.current) return;
      const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = root.current.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (!inside || document.activeElement === last)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kcc20-activity-title"
      className="flex flex-col gap-4 pt-4"
    >
      <div className="flex flex-col items-center gap-1">
        <h3
          id="kcc20-activity-title"
          className="text-lg font-semibold text-white"
        >
          TX Hash
        </h3>
        <span className="text-sm text-daintree-400">
          {formatTime(row.timeMs)}
        </span>
      </div>
      <div className="flex flex-col">
        {/* Only what the feed answered: an absent field drops its row. */}
        {row.status && (
          <DetailRow label="Status">
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium">
              {row.status}
            </span>
          </DetailRow>
        )}
        <DetailRow label="TX ID">
          <span className="truncate font-mono" title={row.txid}>
            {textEllipsis(row.txid)}
          </span>
          <CopyTxId txid={row.txid} />
        </DetailRow>
      </div>
      {explorer && (
        <button
          type="button"
          onClick={() => browser.tabs.create({ url: `${explorer}${row.txid}` })}
          className="flex items-center justify-center gap-2 rounded-xl border border-daintree-700 bg-white/5 px-4 py-3 text-base font-medium text-white hover:border-white"
        >
          View on Explorer
          <ExternalLink aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * KCC-20 history of `token` for `address` from kascov, paged as the sentinel scrolls in.
 * Renders inside the page's scroll body: no height of its own.
 */
export function Kcc20History({
  address,
  token,
}: {
  address?: string;
  token?: Kcc20Token;
}) {
  const {
    entries,
    setSize,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    retry,
    unavailableReason,
    truncatedReason,
  } = useKcc20History(address, token);
  const [selected, setSelected] = useState<Kcc20HistoryRow>();
  const closeDetail = useCallback(() => setSelected(undefined), []);

  const { ref: trigger } = useIntersectionObserver({
    threshold: 0.5,
    onChange: (isIntersecting) => {
      if (isIntersecting && hasMore && !isLoadingMore && !error)
        setSize((prev) => prev + 1);
    },
  });

  const view: TokenView = {
    symbol:
      (token?.meta?.symbol ?? token?.tick) ||
      textEllipsis(token?.covenantId ?? ""),
    decimals: token?.meta?.decimals,
    logo: token?.meta?.logoURI,
  };
  const rows = entries.map(toHistoryRow);

  if (unavailableReason)
    return <Notice>{UNAVAILABLE[unavailableReason]}</Notice>;

  // Page 1 failed: nothing to show but the way back.
  if (error && rows.length === 0)
    return (
      <Notice>
        <div className="flex flex-col items-center gap-3">
          <span>Could not load history.</span>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full border border-daintree-700 px-4 py-1.5 text-white hover:border-white"
          >
            Retry
          </button>
        </div>
      </Notice>
    );

  if (isLoading || !token) return <Spinner />;

  // An events fallback page may hold nothing of this wallet's and still have
  // pages after it: empty means empty only once the query has none left.
  if (rows.length === 0 && !hasMore)
    return (
      <Notice>
        {truncatedReason ? TRUNCATED[truncatedReason] : "No history yet."}
      </Notice>
    );

  return (
    <div className="flex flex-col items-stretch gap-2">
      {rows.map((row) => (
        <Kcc20HistoryItem
          key={row.id}
          row={row}
          token={view}
          onClick={() => setSelected(row)}
        />
      ))}
      {error ? (
        <button
          type="button"
          onClick={() => retry()}
          className="self-center rounded-full border border-daintree-700 px-4 py-1.5 text-sm text-white hover:border-white"
        >
          Retry
        </button>
      ) : (
        (isLoadingMore || rows.length === 0) && <Spinner />
      )}
      {truncatedReason && rows.length > 0 && (
        <p className="text-center text-sm text-daintree-400">
          {TRUNCATED[truncatedReason]}
        </p>
      )}
      {/* A zero-height sentinel sits a subpixel past the scroll body's edge and never fires. */}
      <div ref={trigger} className="h-1 shrink-0" />
      <ActionSheet isOpen={!!selected} onClose={closeDetail}>
        {selected && (
          <Kcc20HistoryDetail row={selected} onClose={closeDetail} />
        )}
      </ActionSheet>
    </div>
  );
}
