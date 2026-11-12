import type { HistoryRecord } from "@/lib/history/types";
import {
  historyDetailStatus,
  type HistoryDetailExtras,
} from "@/ui/popup/history/HistoryDetail";
import { historyFiatText } from "@/ui/popup/history/format";

/**
 * The designed TX sheet's inputs, straight from the record: its own status and
 * its own fiat figure. No conversion, no invented value.
 */
export function historyDetailExtras(
  record: HistoryRecord,
): HistoryDetailExtras {
  return {
    status: historyDetailStatus(record.status),
    fiatText: historyFiatText(record) ?? undefined,
  };
}
