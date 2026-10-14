import { storage } from "wxt/storage";
import type { KatBridgeTx } from "@/lib/bridge/kat-bridge-history";

// Local memory of the Igra exits KAT records against the fee collector
// (kat-bridge-history.ts). The collector's /bridge-history is shared by every
// Kastle user and only its newest rows are read each poll, so an exit seen
// once is kept here and keeps its feed row after it scrolls past that window.
// Same shape as lib/bridge/kurve-local-history.ts: one extension-wide store,
// filtered per account on read.

const KEY = "local:igra_exit_history";

/** The fresh scan's own match rule — toWallet is not checked by isBridgeTx. */
export function paysTo(tx: KatBridgeTx, kaspaAddress: string): boolean {
  return (
    typeof tx.toWallet === "string" &&
    tx.toWallet.toLowerCase() === kaspaAddress.toLowerCase()
  );
}

/**
 * Folds this poll's collector matches into the store (fresh rows win, so a
 * PENDING exit is updated once KAT completes it) and returns every stored exit
 * paying out to `kaspaAddress`. Rows are stored without observedFees — those
 * are re-read from chain each poll. Never throws: a storage failure returns
 * `fresh` as it was.
 */
export async function mergeLocalIgraExits(
  kaspaAddress: string,
  fresh: KatBridgeTx[],
): Promise<KatBridgeTx[]> {
  try {
    const stored = (await storage.getItem<KatBridgeTx[]>(KEY)) ?? [];
    const byId = new Map(stored.map((tx) => [tx.id, tx]));
    let changed = false;
    for (const tx of fresh) {
      const raw = { ...tx };
      delete raw.observedFees;
      const prev = byId.get(raw.id);
      if (prev && JSON.stringify(prev) === JSON.stringify(raw)) continue;
      byId.set(raw.id, raw);
      changed = true;
    }
    if (changed) await storage.setItem(KEY, [...byId.values()]);
    return [...byId.values()].filter((tx) => paysTo(tx, kaspaAddress));
  } catch {
    return fresh;
  }
}
