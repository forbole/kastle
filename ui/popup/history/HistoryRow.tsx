import { useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { HistoryDirection, HistoryRecord } from "@/lib/history/types";
import AssetImage from "@/ui/popup/kcc20/AssetImage";
import {
  historyAmountText,
  historyCounterpartyText,
  historyFiatText,
  historyHoverDateText,
  historyStatusLabel,
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

/** One line of the TX Hash hover card, e.g. KRC-20's "Committed" / "Revealed". */
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
  /** Number on the badge after "TX Hash". */
  txCount?: number;
  /** Replaces the derived "≈ $19.235 USD". */
  fiatText?: string;
  /** Token pages already say which token: drop the symbol after the amount. */
  isSymbolHidden?: boolean;
  /**
   * Status lines in the hover card (KRC-20: Committed, Revealed). Left empty,
   * the card shows the date and a single explorer link.
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
function RowTitle({ record }: { record: HistoryRecord }) {
  const symbol = record.amount.value?.symbol;
  if (record.family === "krc20" && symbol) {
    if (record.kind === "mint" || record.kind === "deploy")
      return (
        <span className="truncate text-sm font-medium text-white">
          {record.kind === "mint" ? "Minted " : "Deployed "}
          <span className="font-bold">{symbol}</span>
        </span>
      );
  }
  return (
    <span className="truncate text-sm font-medium text-white">
      {historyTitle(record.kind, record.family)}
    </span>
  );
}

function HashLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 hover:text-white"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function HashCard({
  record,
  steps,
  cardRef,
  onLeave,
}: {
  record: HistoryRecord;
  steps: HistoryHashStep[];
  cardRef: React.RefObject<HTMLDivElement>;
  onLeave: (e: React.MouseEvent) => void;
}) {
  const date = historyHoverDateText(record.time.value);
  const explorer = record.explorer?.url;
  // Families without Committed / Revealed (KAS, KCC-20, ERC-20, EVM KAS): one
  // line, the record's own status, linking to the explorer.
  const label = historyStatusLabel(record.status);
  const lines: HistoryHashStep[] = steps.length
    ? steps
    : label
      ? [{ label, isDone: record.status === "finalized", href: explorer }]
      : [];
  return (
    // pt-4 is an invisible bridge so the pointer can travel from the label.
    <div
      ref={cardRef}
      role="tooltip"
      onMouseLeave={onLeave}
      className="absolute left-[43px] top-[52px] z-20 pt-4"
    >
      <div className="relative flex flex-col gap-2 rounded bg-daintree-700 px-2.5 py-2 text-xs font-semibold text-gray-200">
        <span
          aria-hidden="true"
          className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-daintree-700"
        />
        <span className="whitespace-nowrap text-sm font-medium text-white">
          TX Hash
        </span>
        {date && (
          <span className="whitespace-nowrap text-daintree-400">{date}</span>
        )}
        {lines.length > 0 ? (
          <ul className="relative flex flex-col gap-2">
            {lines.length > 1 && (
              <span
                aria-hidden="true"
                className="absolute left-2 top-[15px] h-2.5 w-px bg-white/10"
              />
            )}
            {lines.map((step) => {
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
        ) : (
          explorer && (
            <HashLink href={explorer}>
              <span className="whitespace-nowrap">View on explorer</span>
            </HashLink>
          )
        )}
      </div>
    </div>
  );
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

// Logo (or direction icon), what happened, "TX Hash"; amount and fiat on the right.
function DesignedRow({
  record,
  onClick,
  logo,
  chainBadge,
  txCount,
  fiatText,
  isSymbolHidden = false,
  hashSteps = [],
}: {
  record: HistoryRecord;
  onClick?: () => void;
} & HistoryRowExtras) {
  const symbol = record.amount.value?.symbol;
  let amount = historyAmountText(record);
  if (amount && isSymbolHidden && symbol && amount.endsWith(` ${symbol}`))
    amount = amount.slice(0, -(symbol.length + 1));
  const fiat = fiatText ?? historyFiatText(record);
  const tone = movementTone(record);
  const Icon =
    record.kind === "unknown" ? HelpCircle : DIRECTION_ICON[record.direction];

  // The card sits beside the row, not inside it: a link cannot live in a button.
  const [isHashOpen, setIsHashOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const leaves = (to: EventTarget | null, other: Element | null) =>
    !(to instanceof Node && other?.contains(to));

  const content = (
    <>
      {logo || chainBadge ? (
        <AssetImage variant="chain" tokenImage={logo} chainImage={chainBadge} />
      ) : (
        <span
          aria-hidden="true"
          className={twMerge(
            "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5",
            tone,
          )}
        >
          <Icon className="size-5" />
        </span>
      )}
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <RowTitle record={record} />
          <StatusBadge status={record.status} />
        </div>
        <span
          ref={triggerRef}
          onMouseEnter={() => setIsHashOpen(true)}
          onMouseLeave={(e) => {
            if (leaves(e.relatedTarget, cardRef.current)) setIsHashOpen(false);
          }}
          className="flex w-fit items-center gap-2 text-xs text-daintree-400"
        >
          TX Hash
          {txCount !== undefined && (
            <span className="rounded-full bg-white/10 px-[5.5px] py-px text-[10px] font-medium leading-4 text-white">
              {txCount}
            </span>
          )}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1 self-stretch">
        {amount && (
          <span
            className={twMerge(
              "font-medium",
              amount.length > 18 ? "text-xs leading-4" : "text-sm",
              tone,
            )}
          >
            {amount}
          </span>
        )}
        {fiat && <span className="text-xs text-daintree-400">{fiat}</span>}
      </div>
    </>
  );

  return (
    <div className="relative">
      {onClick ? (
        <button type="button" onClick={onClick} className={ROW_CLASS}>
          {content}
        </button>
      ) : (
        <div className={ROW_CLASS}>{content}</div>
      )}
      {isHashOpen && (
        <HashCard
          record={record}
          steps={hashSteps}
          cardRef={cardRef}
          onLeave={(e) => {
            if (leaves(e.relatedTarget, triggerRef.current))
              setIsHashOpen(false);
          }}
        />
      )}
    </div>
  );
}
