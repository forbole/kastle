import React from "react";
import { twMerge } from "tailwind-merge";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import type { HistoryRecord } from "@/lib/history/types";
import {
  historyAmountText,
  historyStatusBadge,
  historySubLine,
  historyTitle,
} from "@/ui/popup/evm-history/format";

export {
  formatRawAmount,
  historyAmountText,
  historyStatusBadge,
  historySubLine,
  historyTimeText,
  historyTitle,
} from "@/ui/popup/evm-history/format";

export interface EvmHistoryRowProps {
  record: HistoryRecord;
  /** Token (or native coin) image, 40 px. */
  logo?: string;
  symbol?: string;
  /** Network badge, 16 px. */
  chainImage?: string;
}

// Card classes copied from components/krc20-asset/TokenHistoryItem.tsx.
const CARD =
  "flex w-full items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left";

export function EvmHistoryRow({
  record,
  logo,
  symbol,
  chainImage,
}: EvmHistoryRowProps) {
  const amount = historyAmountText(
    symbol && record.amount.value
      ? {
          ...record,
          amount: {
            ...record.amount,
            value: { ...record.amount.value, symbol },
          },
        }
      : record,
  );
  const badge = historyStatusBadge(record.status);
  const sub = historySubLine(record);

  const body = (
    <>
      <Layer2AssetImage
        tokenImage={logo}
        chainImage={chainImage}
        tokenImageSize={40}
        chainImageSize={16}
      />
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-white">
            {historyTitle(record.kind)}
            {badge && (
              <span
                className={twMerge(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  badge === "Failed"
                    ? "bg-red-400/10 text-red-400"
                    : "bg-daintree-700 text-daintree-400",
                )}
              >
                {badge}
              </span>
            )}
          </span>
          {amount && (
            <span
              className={twMerge(
                "shrink-0 text-sm font-medium",
                record.direction === "in" && "text-[#14B8A6]",
                record.direction === "out" && "text-[#EF4444]",
                record.direction === "self" && "text-white",
              )}
            >
              {amount}
            </span>
          )}
        </div>
        {sub && (
          <span className="truncate text-xs text-daintree-400">{sub}</span>
        )}
      </div>
    </>
  );

  if (!record.explorer) {
    return <div className={CARD}>{body}</div>;
  }

  const url = record.explorer.url;
  return (
    <button
      type="button"
      className={twMerge(CARD, "hover:border-daintree-600")}
      onClick={() => browser.tabs.create({ url })}
    >
      {body}
      <i className="hn hn-external-link size-4 shrink-0 text-daintree-400" />
    </button>
  );
}
