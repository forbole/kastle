import { formatZkasAmount } from "@/lib/zkas/amount";
import type { ZKasHistory } from "@/lib/zkas/client";
import { historyDetailLabels } from "@/lib/zkas/history-detail";

type HistoryRow = ZKasHistory["rows"][number];

function historyTime(timestamp: number): string {
  const date = new Date(timestamp);
  return timestamp > 0 && Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Not available";
}

export default function ZKasHistoryEntry({
  row,
  showBalance,
}: {
  row: HistoryRow;
  showBalance: boolean;
}) {
  const direction =
    row.kind === "sent"
      ? "Sent"
      : row.kind === "received"
        ? "Received"
        : "Coinbase";
  const amount = showBalance
    ? `${formatZkasAmount(BigInt(row.amountSompiExact))} ZKAS`
    : "*****";
  const labels = historyDetailLabels(row);
  const fee =
    row.feeKnown === false ||
    (row.feeKnown === undefined && row.feeSompiExact === "0")
      ? "Not available"
      : showBalance
        ? `${formatZkasAmount(BigInt(row.feeSompiExact))} ZKAS`
        : "*****";

  return (
    <details className="rounded-lg bg-daintree-800 p-3 text-xs">
      <summary className="cursor-pointer">
        {direction} · {amount}
        {row.kind === "sent" && row.amountKind === "netOutflow"
          ? " net outflow"
          : ""}
        <span className="ml-2 text-daintree-400">Details</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-daintree-700 pt-3">
        <p>
          {labels.amount}: {amount}
        </p>
        {row.kind === "sent" && <p>Fee: {fee}</p>}
        <p>Time: {historyTime(row.timestamp)}</p>
        {row.daaScore !== undefined && <p>DAA score: {row.daaScore}</p>}
        <p className="break-all">Transaction ID: {row.txid}</p>
        <p className="break-all">
          {labels.recipient}: {row.recipient ?? "Not available"}
        </p>
        {labels.firstRecipientOnly && (
          <p className="text-daintree-400">
            A payment with multiple outputs may show only its first recipient.
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">
          Memo: {row.memo || "Not available"}
        </p>
        <p className="text-daintree-400">
          Details are reported by your connected ZKas daemon.
        </p>
      </div>
    </details>
  );
}
