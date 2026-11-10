import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HelpCircle,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { HistoryDirection, HistoryRecord } from "@/lib/history/types";
import {
  historyAmountText,
  historyCounterpartyText,
  historyTimeText,
  historyTitle,
} from "@/ui/popup/history/format";

const DIRECTION_ICON: Record<HistoryDirection, typeof ArrowUpRight> = {
  in: ArrowDownLeft,
  out: ArrowUpRight,
  self: ArrowLeftRight,
};

const ROW_CLASS =
  "flex w-full shrink-0 items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white";

// Movement colour: in and out only; self and unattributed stay neutral.
function movementTone(record: HistoryRecord) {
  if (record.kind === "unknown" || record.direction === "self")
    return "text-white";
  return record.direction === "out" ? "text-red-500" : "text-teal-500";
}

function StatusBadge({ status }: { status: HistoryRecord["status"] }) {
  if (status === "pending")
    return (
      <span className="shrink-0 rounded-full bg-daintree-700 px-2 py-0.5 text-xs font-medium text-daintree-400">
        Pending
      </span>
    );
  if (status === "failed")
    return (
      <span className="shrink-0 rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">
        Failed
      </span>
    );
  return null;
}

// Direction, what happened, who with; amount and time on the right.
export function HistoryRow({
  record,
  onClick,
}: {
  record: HistoryRecord;
  onClick?: () => void;
}) {
  const amount = historyAmountText(record);
  const counterparty = historyCounterpartyText(record);
  const time = historyTimeText(record.time.value);
  const tone = movementTone(record);
  const Icon =
    record.kind === "unknown" ? HelpCircle : DIRECTION_ICON[record.direction];

  const content = (
    <>
      <span
        aria-hidden="true"
        className={twMerge(
          "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5",
          tone,
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base text-white">
            {historyTitle(record.kind, record.family)}
          </span>
          <StatusBadge status={record.status} />
        </div>
        {counterparty && (
          <span className="truncate text-sm text-daintree-400">
            {counterparty}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {amount && <span className={twMerge("text-base", tone)}>{amount}</span>}
        {time && <span className="text-sm text-daintree-400">{time}</span>}
      </div>
    </>
  );

  if (!onClick) return <div className={ROW_CLASS}>{content}</div>;
  return (
    <button type="button" onClick={onClick} className={ROW_CLASS}>
      {content}
    </button>
  );
}
