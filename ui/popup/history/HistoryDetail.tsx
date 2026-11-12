import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleX,
  ClockFading,
  Copy,
  ExternalLink,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import Button from "@/ui/general/Button";
import type { HistoryRecord } from "@/lib/history/types";
import type { HistoryHashStep } from "@/ui/popup/history/HistoryRow";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import { formatCurrency, textEllipsis } from "@/lib/utils";
import {
  historyAmountText,
  historyDesignedCounterparty,
  historyFiatUsd,
  historyNamesCounterparty,
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
      root.current?.querySelector<HTMLElement>(
        `:is(${FOCUSABLE}):not([data-no-autofocus])`,
      ) ?? root.current
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
  /**
   * Status lines (KRC-20: Committed, Revealed). When set they replace the
   * status pill; the list passes them through from the row's extras.
   */
  hashSteps?: HistoryHashStep[];
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

/** The Status row's list for families with steps: a check circle each, a link when the step has one. */
function StatusSteps({ steps }: { steps: HistoryHashStep[] }) {
  return (
    <ul className="flex flex-col items-end gap-2">
      {steps.map((step) => {
        const Icon = step.isDone ? CheckCircle2 : Circle;
        return (
          <li key={step.label} className="flex items-center gap-1">
            <span className="flex items-center gap-2 whitespace-nowrap">
              <Icon
                aria-hidden="true"
                className={twMerge(
                  "size-4",
                  step.isDone ? "text-teal-500" : "text-daintree-400",
                )}
              />
              {step.label}
              <span className="sr-only">
                {step.isDone ? ", done" : ", pending"}
              </span>
            </span>
            {step.href && (
              <a
                href={step.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`${step.label} on explorer`}
                className="text-daintree-400 hover:text-white"
              >
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The To / From value with its full address in a tooltip, on hover and on keyboard focus. */
function AddressValue({ text, full }: { text: string; full: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative min-w-0">
      {/* Focusable but kept out of the sheet's first-focus pick, so opening the sheet never opens this. */}
      <span
        tabIndex={0}
        data-no-autofocus=""
        aria-describedby={isOpen ? id : undefined}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onKeyDown={(e) => {
          // First Escape closes only the tooltip; the sheet's own listener
          // (on document) never sees it. A second Escape closes the sheet.
          if (e.key !== "Escape" || !isOpen) return;
          e.stopPropagation();
          setIsOpen(false);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        className="block truncate rounded text-white outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        {text}
      </span>
      {isOpen && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full right-0 z-20 mb-2 block w-max max-w-[16rem] break-all rounded bg-daintree-700 px-2.5 py-2 text-left text-xs text-white"
        >
          {full}
          <span
            aria-hidden="true"
            className="absolute -bottom-1 right-4 size-2 rotate-45 bg-daintree-700"
          />
        </span>
      )}
    </span>
  );
}

/** Mobile's TX sheet: left-aligned title and time, divider, Status first, outlined explorer button. */
function DesignedDetail({
  record,
  onClose,
  status,
  fiatText,
  hashSteps = [],
}: {
  record: HistoryRecord;
  onClose: () => void;
} & HistoryDetailExtras) {
  const root = useDetailDialog(onClose);
  const time = historyTimeText(record.time.value);
  const explorer = record.explorer;
  const shownStatus = status ?? historyDetailStatus(record.status);
  const amount = historyAmountText(record);
  const who = historyNamesCounterparty(record)
    ? historyDesignedCounterparty(record)
    : null;

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
        <div
          className={twMerge(
            "flex justify-between gap-4 text-sm",
            hashSteps.length ? "items-start" : "items-center",
          )}
        >
          <span className="shrink-0 text-daintree-400">Status</span>
          <div className="flex min-w-0 items-center justify-end text-white">
            {hashSteps.length ? (
              <StatusSteps steps={hashSteps} />
            ) : (
              <StatusValue {...shownStatus} />
            )}
          </div>
        </div>
        {amount && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 text-daintree-400">Amount</span>
            <span className="min-w-0 break-all text-right text-white">
              {amount}
            </span>
          </div>
        )}
        {fiatText && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 text-daintree-400">Value</span>
            <span className="text-white">{fiatText}</span>
          </div>
        )}
        {who && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 text-daintree-400">
              {record.direction === "in" ? "From" : "To"}
            </span>
            <AddressValue
              text={who}
              full={record.counterparty.value?.address ?? who}
            />
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
  // Steps alone never switch to the designed sheet: only status / fiat do.
  const isDesigned = Object.entries(extras).some(
    ([key, v]) => key !== "hashSteps" && v !== undefined,
  );
  return isDesigned ? (
    <DesignedDetail record={record} onClose={onClose} {...extras} />
  ) : (
    <LegacyDetail record={record} onClose={onClose} />
  );
}
