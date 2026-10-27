import AssetImage from "@/ui/popup/kcc20/AssetImage";
import CurveProgress from "./CurveProgress";
import { KASSEAL_LABELS } from "./labels";

export interface TokenRowProps {
  name: string;
  ticker: string;
  logo?: string;
  /** Curve fill 0–100; omitted once the token has graduated. */
  progress?: number;
  /** Display-ready market cap, e.g. "12,345 KAS". */
  marketCap?: string;
  onClick?: () => void;
}

export default function TokenRow({
  name,
  ticker,
  logo,
  progress,
  marketCap,
  onClick,
}: TokenRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 rounded-lg py-3 text-left enabled:hover:bg-daintree-800"
    >
      <AssetImage variant="chain" tokenImage={logo} fallback={ticker} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-white">
            {name}
          </span>
          {marketCap && (
            <span className="shrink-0 text-xs text-daintree-400">
              {marketCap}
            </span>
          )}
        </div>
        <span className="text-xs text-daintree-400">{ticker}</span>
        {progress === undefined ? (
          <span className="text-xs text-icy-blue-200">
            {KASSEAL_LABELS.graduated}
          </span>
        ) : (
          <CurveProgress percent={progress} compact />
        )}
      </div>
    </button>
  );
}
