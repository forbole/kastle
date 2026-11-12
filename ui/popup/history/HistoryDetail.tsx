import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleCheck,
  CircleX,
  ClockFading,
  Copy,
  ExternalLink,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import Button from "@/ui/general/Button";
import type { HistoryRecord } from "@/lib/history/types";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import { formatCurrency, textEllipsis } from "@/lib/utils";
import {
  historyFiatUsd,
  historyStatusLabel,
  historyTimeText,
} from "@/ui/popup/history/format";

const FOCUSABLE =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

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

/**
 * The sheet holds focus while open, Escape closes it, and focus returns on
 * close. Shared by both layouts so they cannot drift.
 */
function useDetailDialog(onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // No txid and no explorer leaves no control: the root takes focus instead.
    (
      root.current?.querySelector<HTMLElement>(FOCUSABLE) ?? root.current
    )?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !root.current) return;
      const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        event.preventDefault();
        root.current.focus();
        return;
      }
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

  return root;
}

/** The pre-redesign sheet: TX Hash, the time, Status when known, TX ID, explorer. */
function LegacyDetail({
  record,
  onClose,
}: {
  record: HistoryRecord;
  onClose: () => void;
}) {
  const time = historyTimeText(record.time.value);
  const status = historyStatusLabel(record.status);
  const explorer = record.explorer;
  const usd = historyFiatUsd(record);
  const fiat = useCurrencyValue(usd ?? 0);

  const root = useDetailDialog(onClose);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-detail-title"
      tabIndex={-1}
      className="flex flex-col gap-4 pt-4 outline-none"
    >
      <div className="flex flex-col items-center gap-1">
        <h3
          id="history-detail-title"
          className="text-lg font-semibold text-white"
        >
          TX Hash
        </h3>
        {time && <span className="text-sm text-daintree-400">{time}</span>}
      </div>
      <div className="flex flex-col">
        {/* Only what the source answered: an absent field drops its row. */}
        {status && (
          <DetailRow label="Status">
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium">
              {status}
            </span>
          </DetailRow>
        )}
        {usd !== null && (
          <DetailRow label="Value">
            <span>≈ {formatCurrency(fiat.amount, fiat.code)}</span>
          </DetailRow>
        )}
        {record.txid && (
          <DetailRow label="TX ID">
            <span className="truncate font-mono" title={record.txid}>
              {textEllipsis(record.txid)}
            </span>
            <CopyTxId txid={record.txid} />
          </DetailRow>
        )}
      </div>
      {explorer && (
        <button
          type="button"
          onClick={() => browser.tabs.create({ url: explorer.url })}
          className="flex items-center justify-center gap-2 rounded-xl border border-daintree-700 bg-white/5 px-4 py-3 text-base font-medium text-white hover:border-white"
        >
          View on Explorer
          <ExternalLink aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

export type HistoryDetailStatusTone =
  | "success"
  | "pending"
  | "failed"
  | "neutral";

/**
 * Everything the sheet shows beyond the record itself. All optional, so a
 * screen that passes none keeps the pre-redesign sheet.
 */
export interface HistoryDetailExtras {
  /** Replaces the status word and colour derived from the record. */
  status?: { label: string; tone: HistoryDetailStatusTone };
  /** The Value row text, e.g. "≈ $19.235 USD"; without it there is no Value row. */
  fiatText?: string;
}

const PILL: Record<
  Exclude<HistoryDetailStatusTone, "neutral">,
  { icon: typeof CircleCheck; className: string }
> = {
  success: { icon: CircleCheck, className: "bg-teal-400/10 text-teal-400" },
  pending: { icon: ClockFading, className: "bg-amber-400/10 text-amber-400" },
  failed: { icon: CircleX, className: "bg-red-400/10 text-red-400" },
};

// The record's own status, in mobile's words: "Unconfirmed" when the source
// never said either way, shown neutral rather than as pending.
export function historyDetailStatus(status: HistoryRecord["status"]) {
  const tone: HistoryDetailStatusTone =
    status === "finalized"
      ? "success"
      : status === "pending"
        ? "pending"
        : status === "failed"
          ? "failed"
          : "neutral";
  return {
    label: historyStatusLabel(status) ?? "Unconfirmed",
    tone,
  };
}

function StatusValue({
  label,
  tone,
}: {
  label: string;
  tone: HistoryDetailStatusTone;
}) {
  if (tone === "neutral") return <span>{label}</span>;
  const { icon: Icon, className } = PILL[tone];
  return (
    <span
      className={twMerge(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}

/** Mobile's TX sheet: left-aligned title and time, divider, Status first, outlined explorer button. */
function DesignedDetail({
  record,
  onClose,
  status,
  fiatText,
}: {
  record: HistoryRecord;
  onClose: () => void;
} & HistoryDetailExtras) {
  const root = useDetailDialog(onClose);
  const time = historyTimeText(record.time.value);
  const explorer = record.explorer;
  const shownStatus = status ?? historyDetailStatus(record.status);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-detail-title"
      tabIndex={-1}
      className="flex flex-col gap-4 pt-4 outline-none"
    >
      <div className="flex flex-col items-start gap-3 border-b border-daintree-700 pb-4">
        <h3
          id="history-detail-title"
          className="text-lg font-semibold text-white"
        >
          TX Hash
        </h3>
        {time && <span className="text-sm text-daintree-400">{time}</span>}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="shrink-0 text-daintree-400">Status</span>
          <div className="flex min-w-0 items-center justify-end text-white">
            <StatusValue {...shownStatus} />
          </div>
        </div>
        {fiatText && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 text-daintree-400">Value</span>
            <span className="text-white">{fiatText}</span>
          </div>
        )}
        {record.txid && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 text-daintree-400">TX ID</span>
            <div className="flex min-w-0 items-center justify-end gap-2 text-white">
              <span className="truncate font-mono" title={record.txid}>
                {textEllipsis(record.txid)}
              </span>
              <CopyTxId txid={record.txid} />
            </div>
          </div>
        )}
        {explorer && (
          <div className="mt-2">
            <Button
              variant="secondary"
              onClick={() => browser.tabs.create({ url: explorer.url })}
            >
              <span className="inline-flex items-center gap-2">
                View on Explorer
                <ExternalLink aria-hidden="true" className="size-4" />
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The designed sheet applies only when a screen passes at least one extra;
 * with none it is the pre-redesign sheet, text for text.
 */
export function HistoryDetail({
  record,
  onClose,
  ...extras
}: {
  record: HistoryRecord;
  onClose: () => void;
} & HistoryDetailExtras) {
  const isDesigned = Object.values(extras).some((v) => v !== undefined);
  return isDesigned ? (
    <DesignedDetail record={record} onClose={onClose} {...extras} />
  ) : (
    <LegacyDetail record={record} onClose={onClose} />
  );
}
