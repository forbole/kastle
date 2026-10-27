import { twMerge } from "tailwind-merge";
import Button from "@/ui/general/Button";
import { KASSEAL_LABELS, SLIPPAGE_OPTIONS_BPS } from "./labels";

export interface TradePanelProps {
  side: "buy" | "sell";
  onSideChange: (side: "buy" | "sell") => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  /** Unit of the amount input: "KAS" on buy, the ticker on sell. */
  unit: string;
  /** Display-ready estimate of what the trade returns. */
  estimate?: string;
  slippageBps: number;
  onSlippageChange: (bps: number) => void;
  error?: string;
  busy?: boolean;
  canReview: boolean;
  onReview: () => void;
}

export default function TradePanel({
  side,
  onSideChange,
  amount,
  onAmountChange,
  unit,
  estimate,
  slippageBps,
  onSlippageChange,
  error,
  busy = false,
  canReview,
  onReview,
}: TradePanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-daintree-800 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSideChange(s)}
            className={twMerge(
              "rounded-lg py-2 text-sm font-semibold",
              side === s ? "bg-icy-blue-400 text-white" : "text-daintree-400",
            )}
          >
            {s === "buy" ? KASSEAL_LABELS.buy : KASSEAL_LABELS.sell}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-xs text-daintree-400">
          {side === "buy" ? KASSEAL_LABELS.youPay : KASSEAL_LABELS.youSell}
        </span>
        <div className="flex items-center gap-2 rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3">
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-white outline-none"
          />
          <span className="text-sm text-daintree-400">{unit}</span>
        </div>
      </label>

      {estimate && (
        <div className="flex justify-between text-sm">
          <span className="text-daintree-400">{KASSEAL_LABELS.youReceive}</span>
          <span className="text-white">{estimate}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-daintree-400">{KASSEAL_LABELS.slippage}</span>
        <div className="flex gap-1">
          {SLIPPAGE_OPTIONS_BPS.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => onSlippageChange(bps)}
              className={twMerge(
                "rounded-full border px-2 py-0.5 text-xs",
                slippageBps === bps
                  ? "border-icy-blue-400 text-white"
                  : "border-daintree-700 text-daintree-400",
              )}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        size="lg"
        disabled={!canReview || busy}
        loading={busy}
        onClick={onReview}
      >
        {KASSEAL_LABELS.review}
      </Button>
    </div>
  );
}
