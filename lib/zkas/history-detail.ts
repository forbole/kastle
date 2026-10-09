import type { ZKasHistory } from "./client";

type HistoryRow = ZKasHistory["rows"][number];

export function historyDetailLabels(row: HistoryRow) {
  return {
    amount:
      row.kind !== "sent"
        ? "Amount"
        : row.amountKind === "netOutflow"
          ? "Net outflow"
          : row.amountKind === "paid"
            ? "Total paid"
            : "Daemon-reported amount",
    recipient: row.kind === "received" ? "Received at" : "Reported recipient",
    firstRecipientOnly: row.kind === "sent" && Boolean(row.recipient),
  };
}
