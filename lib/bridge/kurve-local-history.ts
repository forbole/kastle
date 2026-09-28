import { storage } from "wxt/storage";
import {
  KurveBridgePostBody,
  LocalKurveRecord,
  postKurveBridgeRecord,
} from "@/lib/bridge/kat-registry";

// Local backup for Kurve bridge txs, ported from kastle-mobile
// lib/bridge/kurve-local-history.ts. KAT's /kurve-bridge registry is
// self-reported: a failed POST would silently drop the tx from Activity, so
// every broadcast is persisted here first and the feed merges registry status
// over these records (kat-registry.ts).

const KEY = "local:kurve_bridge_history";

/**
 * Records where one of `wallets` is sender or recipient — the registry's own
 * match rule. The store is shared by every account in the extension, so an
 * unfiltered read would leak one account's bridges into another's feed.
 */
export async function readLocalKurveRecords(
  wallets: string[],
): Promise<LocalKurveRecord[]> {
  const mine = new Set(wallets.map((w) => w.toLowerCase()));
  const records = (await storage.getItem<LocalKurveRecord[]>(KEY)) ?? [];
  return records.filter(
    (r) =>
      mine.has(r.sender.toLowerCase()) || mine.has(r.recipient.toLowerCase()),
  );
}

async function appendLocalKurveRecord(record: LocalKurveRecord): Promise<void> {
  const records = (await storage.getItem<LocalKurveRecord[]>(KEY)) ?? [];
  if (records.some((r) => r.originTxHash === record.originTxHash)) return;
  records.push(record);
  await storage.setItem(KEY, records);
}

/**
 * Post-broadcast tracking for both Kurve directions: local backup first (the
 * feed row must survive a failed POST / popup close), then registry POST.
 * Fire and forget — never throws, callers use `void trackKurveBridge(...)`.
 */
export async function trackKurveBridge(
  body: KurveBridgePostBody,
  timestampMs: number,
): Promise<void> {
  try {
    await appendLocalKurveRecord({ ...body, timestamp: timestampMs });
  } catch {
    // storage failure — the registry POST below can still record it
  }
  await postKurveBridgeRecord(body);
}
