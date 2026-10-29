import { storage } from "wxt/storage";
import type { KassealNetwork } from "@kassealhq/sdk";
import type { KassealTxStatus } from "./api";
import {
  decodeKassealAttempt,
  encodeKassealAttempt,
  KassealAttempt,
  settleKassealAttempt,
  StoredKassealAttempt,
} from "./trade";

// Open Kasseal attempts, one per network, account and token. Kept across
// popup closes so a reopened trade screen rebuilds on the same pinned coins
// instead of funding a second trade while the first is still in flight.

const KEY = "local:kasseal_attempts";

type Store = Record<string, StoredKassealAttempt>;

export const kassealAttemptKey = (
  network: KassealNetwork,
  address: string,
  covenantId: string,
) => `${network}:${address}:${covenantId}`;

export async function loadKassealAttempt(
  key: string,
): Promise<KassealAttempt | undefined> {
  const stored = (await storage.getItem<Store>(KEY))?.[key];
  return stored && decodeKassealAttempt(stored);
}

export async function saveKassealAttempt(
  key: string,
  attempt: KassealAttempt,
): Promise<void> {
  const store = (await storage.getItem<Store>(KEY)) ?? {};
  await storage.setItem<Store>(KEY, {
    ...store,
    [key]: encodeKassealAttempt(attempt),
  });
}

export async function clearKassealAttempt(key: string): Promise<void> {
  const store = (await storage.getItem<Store>(KEY)) ?? {};
  if (!(key in store)) return;
  delete store[key];
  await storage.setItem<Store>(KEY, store);
}

/**
 * The account's attempts that may still land, by covenant id. An attempt
 * that landed or dropped while the popup was closed is cleared here.
 */
export async function loadOpenKassealAttempts(
  network: KassealNetwork,
  address: string,
  status: (txid: string) => Promise<KassealTxStatus>,
): Promise<Record<string, KassealAttempt>> {
  const prefix = kassealAttemptKey(network, address, "");
  const store = (await storage.getItem<Store>(KEY)) ?? {};
  const open: Record<string, KassealAttempt> = {};
  for (const [key, stored] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue;
    const attempt = decodeKassealAttempt(stored);
    if ((await settleKassealAttempt(attempt, status)) === "open")
      open[key.slice(prefix.length)] = attempt;
    else await clearKassealAttempt(key).catch(() => {});
  }
  return open;
}
