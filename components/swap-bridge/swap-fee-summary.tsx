import React from "react";
import { formatAmount } from "@/lib/format-amount";

export function FeeRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-semibold text-white">{label}</span>
        <span className="flex-none whitespace-nowrap text-white">{value}</span>
      </div>
      {note && <span className="text-xs text-daintree-400">{note}</span>}
    </div>
  );
}

export function SwapFeeFootnote({
  kastleFee,
  kastleFeeBps,
}: {
  kastleFee: number;
  kastleFeeBps: number;
}) {
  if (kastleFee <= 0) return null;
  return (
    <p className="flex items-center gap-2 border-t border-daintree-700 px-4 py-3 text-xs font-medium text-daintree-400">
      <i className="hn hn-info-circle text-base" />
      Quote includes {kastleFeeBps / 100}% Kastle Fee
    </p>
  );
}

export function SwapFeeSummary({
  kastleFee,
  kastleFeeSymbol,
  kastleFeeBps,
}: {
  kastleFee: number;
  kastleFeeSymbol?: string;
  kastleFeeBps: number;
}) {
  return (
    <FeeRow
      label="Kastle fees"
      value={
        kastleFee > 0 ? `${formatAmount(kastleFee)} ${kastleFeeSymbol}` : "-"
      }
      note={
        kastleFee > 0
          ? `Quote includes ${kastleFeeBps / 100}% Kastle Fee`
          : undefined
      }
    />
  );
}
