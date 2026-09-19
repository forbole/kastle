import { ApiResponseSchema, ZKasDappDeliveryAckSchema } from "@/api/message";
import { ZKAS_DAPP_ALARM_PREFIX, zkasDappPendingStore, type ZKasDappPending } from "@/lib/zkas/dapp-payment";

type PaymentOutcome =
  | { txid: string; daemonReportedFeeSompi: string }
  | { error: string };

async function deliver(record: ZKasDappPending, outcome: PaymentOutcome): Promise<boolean> {
  const response = ApiResponseSchema.parse({
    id: record.pageRequestId,
    source: "background",
    target: "browser",
    response: "error" in outcome ? null : outcome,
    ...("error" in outcome ? { error: outcome.error } : {}),
  });
  try {
    const acknowledgement = await browser.tabs.sendMessage(record.tabId, {
      kind: "ZKAS_DAPP_RESULT",
      origin: record.origin,
      response,
    }, { frameId: record.frameId });
    const parsed = ZKasDappDeliveryAckSchema.safeParse(acknowledgement);
    return parsed.success && parsed.data.origin === record.origin;
  } catch {
    // The requesting frame may have navigated or closed. The popup still has
    // the transaction result, and the account journal preserves uncertainty.
    return false;
  }
}

export async function finishZKasDappPayment(approvalId: string, outcome: PaymentOutcome): Promise<{ finalized: boolean; delivered: boolean }> {
  const record = await zkasDappPendingStore.take(approvalId);
  if (!record) return { finalized: false, delivered: false };
  try { await browser.alarms.clear(`${ZKAS_DAPP_ALARM_PREFIX}${approvalId}`); } catch { /* Delivery still matters. */ }
  return { finalized: true, delivered: await deliver(record, outcome) };
}

export function listenForZKasDappPaymentClosure(): void {
  browser.windows.onRemoved.addListener((windowId) => {
    void (async () => {
      const record = await zkasDappPendingStore.takeByWindow(windowId);
      if (!record) return;
      try { await browser.alarms.clear(`${ZKAS_DAPP_ALARM_PREFIX}${record.approvalId}`); } catch { /* Delivery still matters. */ }
      await deliver(record, { error: "ZKas payment window closed. Check Kastle activity before retrying." });
    })().catch(() => undefined);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(ZKAS_DAPP_ALARM_PREFIX)) return;
    void finishZKasDappPayment(alarm.name.slice(ZKAS_DAPP_ALARM_PREFIX.length), {
      error: "ZKas payment approval timed out. Check Kastle activity before retrying.",
    }).catch(() => undefined);
  });
}
