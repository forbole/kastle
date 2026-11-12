import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
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

/** Activity sheet: TX Hash, the time, Status when known, TX ID, explorer. */
export function HistoryDetail({
  record,
  onClose,
}: {
  record: HistoryRecord;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const time = historyTimeText(record.time.value);
  const status = historyStatusLabel(record.status);
  const explorer = record.explorer;
  const usd = historyFiatUsd(record);
  const fiat = useCurrencyValue(usd ?? 0);

  // The sheet holds focus while open, Escape closes it, and focus returns on close.
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
