import type { StorageItemKey } from "@wxt-dev/storage";

export const WALLET_SETTINGS_STORAGE_KEY = "local:wallet-settings";
const WALLET_SETTINGS_LOCK = "kastle:wallet-settings";

export async function withWalletSettingsLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    throw new Error("Wallet update locking is unavailable in this browser");
  return navigator.locks.request(WALLET_SETTINGS_LOCK, operation);
}

export async function updateWalletSettingsLocked<T>(
  key: StorageItemKey,
  update: (current: T) => T | Promise<T>,
  options: { expectedJson?: string; fallback?: T } = {},
): Promise<T> {
  if (key !== WALLET_SETTINGS_STORAGE_KEY)
    throw new Error("Invalid wallet settings key");
  return withWalletSettingsLock(async () => {
    const stored = await storage.getItem<T>(key);
    const current = stored ?? options.fallback;
    if (current === undefined)
      throw new Error("Wallet settings are unavailable");
    if (
      options.expectedJson !== undefined &&
      JSON.stringify(current) !== options.expectedJson
    ) {
      throw new Error("Wallets changed in another window. Review and retry.");
    }
    const next = await update(current);
    await storage.setItem(key, next);
    return next;
  });
}
