import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HelpCircle,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { HistoryDirection, HistoryRecord } from "@/lib/history/types";
import AssetImage from "@/ui/popup/kcc20/AssetImage";
import {
  historyAmountText,
  historyCounterpartyText,
  historyFiatText,
  historyRowDateText,
  historyRowTitle,
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

// Designed row: logo sits closer to its text than the legacy row's gap-3.
const DESIGNED_ROW_CLASS = twMerge(ROW_CLASS, "gap-2");

// Movement colour: in and out only; self and unattributed stay neutral.
function movementTone(record: HistoryRecord) {
  if (record.kind === "unknown" || record.direction === "self")
    return "text-white";
  return record.direction === "out" ? "text-red-500" : "text-teal-500";
}

/** One line of the detail sheet's status list, e.g. KRC-20's "Committed" / "Revealed". */
export interface HistoryHashStep {
  label: string;
  isDone: boolean;
  /** Explorer link for this step; shows the external-link icon when set. */
  href?: string;
}

/**
 * Everything the row shows beyond the record itself. All optional, so a
 * screen that passes none keeps the plain direction-icon row.
 */
export interface HistoryRowExtras {
  /** Token logo URL; with `chainBadge` it replaces the direction icon. */
  logo?: string;
  /** Small chain mark on the logo's corner. */
  chainBadge?: string;
  /** No longer drawn on the row; kept so existing callers still compile. */
  txCount?: number;
  /** Replaces the derived "≈ $19.235 USD". */
  fiatText?: string;
  /** No-op: the row always shows the symbol. Kept so existing callers still compile. */
  isSymbolHidden?: boolean;
  /**
   * Status lines (KRC-20: Committed, Revealed). Not drawn on the row: the list
   * hands them to the detail sheet. Left empty, the sheet keeps its status pill.
   */
  hashSteps?: HistoryHashStep[];
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

// KRC-20 mints and deploys read "Minted TTTT": the symbol is the subject.
// A plain send / receive names the other side: "Sent to kaspa:qp...mrp".
function RowTitle({ record }: { record: HistoryRecord }) {
  const symbol = record.amount.value?.symbol;
  const className = "min-w-0 truncate text-sm font-medium text-white";
  if (record.family === "krc20" && symbol) {
    if (record.kind === "mint" || record.kind === "deploy")
      return (
        <span className={className}>
          {record.kind === "mint" ? "Minted " : "Deployed "}
          <span className="font-bold">{symbol}</span>
        </span>
      );
  }
  return <span className={className}>{historyRowTitle(record)}</span>;
}

// The row as it was before the redesign: direction icon, "To/From …", date.
// What a screen gets until it passes any extra.
function LegacyRow({
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

/**
 * The designed row applies only when a screen passes at least one extra;
 * with none it is the pre-redesign row, text for text.
 */
export function HistoryRow(
  props: { record: HistoryRecord; onClick?: () => void } & HistoryRowExtras,
) {
  const { record, onClick, ...extras } = props;
  const isDesigned = Object.values(extras).some((v) => v !== undefined);
  return isDesigned ? (
    <DesignedRow record={record} onClick={onClick} {...extras} />
  ) : (
    <LegacyRow record={record} onClick={onClick} />
  );
}

// Logo (or direction icon); a two-line grid: title + amount, then date + fiat.
function DesignedRow({
  record,
  onClick,
  logo,
  chainBadge,
  fiatText,
}: {
  record: HistoryRecord;
  onClick?: () => void;
} & HistoryRowExtras) {
  const amount = historyAmountText(record);
  const fiat = fiatText ?? historyFiatText(record);
  const date = historyRowDateText(record.time.value);
  const tone = movementTone(record);
  const Icon =
    record.kind === "unknown" ? HelpCircle : DIRECTION_ICON[record.direction];

  const content = (
    <>
      {logo || chainBadge ? (
        <AssetImage
          variant="chain"
          tokenImage={logo}
          chainImage={chainBadge}
          tokenImageSize={32}
          chainImageSize={14}
        />
      ) : (
        <span
          aria-hidden="true"
          className={twMerge(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5",
            tone,
          )}
        >
          <Icon className="size-4" />
        </span>
      )}
      {/* The amount takes what it needs (full ticker) and the title gives way;
          the 60% cap only stops an absurd amount from squeezing the title out. */}
      <div className="grid min-w-0 flex-grow grid-cols-[minmax(0,1fr)_fit-content(60%)] grid-rows-[auto_minmax(1rem,auto)] gap-x-2 gap-y-1">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 leading-5">
          <RowTitle record={record} />
          <StatusBadge status={record.status} />
        </div>
        {amount && (
          <span
            title={amount}
            className={twMerge(
              "col-start-2 row-start-1 min-w-0 truncate whitespace-nowrap text-right text-sm font-medium leading-5",
              tone,
            )}
          >
            {amount}
          </span>
        )}
        {date && (
          <span className="col-start-1 row-start-2 w-fit text-xs text-daintree-400">
            {date}
          </span>
        )}
        {fiat && (
          <span className="col-start-2 row-start-2 min-w-0 truncate text-right text-xs text-daintree-400">
            {fiat}
          </span>
        )}
      </div>
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={DESIGNED_ROW_CLASS}>
      {content}
    </button>
  ) : (
    <div className={DESIGNED_ROW_CLASS}>{content}</div>
  );
}
