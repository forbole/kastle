import { storage } from "wxt/storage";
import type { KassealNetwork } from "@kassealhq/sdk";
import {
  decodeKassealAttempt,
  encodeKassealAttempt,
  KassealAttempt,
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
