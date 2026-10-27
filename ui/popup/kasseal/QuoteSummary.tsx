import { KASSEAL_LABELS } from "./labels";

export interface QuoteSummaryProps {
  side: "buy" | "sell";
  /** A curve buy caps KAS paid; every other trade floors what is received. */
  boundKind: "max-paid" | "min-received";
  /** Display-ready amounts with units. */
  pay: string;
  receive: string;
  bound: string;
  fee: string;
  networkFee?: string;
  slippage: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-daintree-400">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  );
}

export default function QuoteSummary({
  side,
  boundKind,
  pay,
  receive,
  bound,
  fee,
  networkFee,
  slippage,
}: QuoteSummaryProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-4">
      <Row
        label={side === "buy" ? KASSEAL_LABELS.youPay : KASSEAL_LABELS.youSell}
        value={pay}
      />
      <Row label={KASSEAL_LABELS.youReceive} value={receive} />
      <Row
        label={
          boundKind === "max-paid"
            ? KASSEAL_LABELS.maxPaid
            : KASSEAL_LABELS.minReceived
        }
        value={bound}
      />
      <Row label={KASSEAL_LABELS.fee} value={fee} />
      {networkFee && (
        <Row label={KASSEAL_LABELS.networkFee} value={networkFee} />
      )}
      <Row label={KASSEAL_LABELS.slippage} value={slippage} />
    </div>
  );
}
