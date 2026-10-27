import { twMerge } from "tailwind-merge";
import { KASSEAL_LABELS } from "./labels";

export interface CurveProgressProps {
  /** 0–100; clamped. */
  percent: number;
  /** Display-ready "raised / target" line, shown when not compact. */
  raised?: string;
  compact?: boolean;
}

export default function CurveProgress({
  percent,
  raised,
  compact = false,
}: CurveProgressProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={twMerge("flex flex-col", compact ? "gap-1" : "gap-2")}>
      {!compact && (
        <div className="flex justify-between text-xs text-daintree-400">
          <span>{KASSEAL_LABELS.progress}</span>
          <span>{clamped.toFixed(1)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={twMerge(
          "w-full overflow-hidden rounded-full bg-white/10",
          compact ? "h-1" : "h-2",
        )}
      >
        <div
          className="h-full rounded-full bg-icy-blue-400"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {!compact && raised && (
        <span className="text-xs text-daintree-400">
          {KASSEAL_LABELS.raised}: {raised}
        </span>
      )}
    </div>
  );
}
