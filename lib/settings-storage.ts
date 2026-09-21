import type { StorageItemKey } from "@wxt-dev/storage";

export const SETTINGS_STORAGE_KEY = "local:settings";
const SETTINGS_LOCK = "kastle:settings";

export async function updateSettingsLocked<T>(
  key: StorageItemKey,
  update: (current: T) => T | Promise<T>,
  options: { expectedJson?: string; fallback?: T } = {},
): Promise<T> {
  if (key !== SETTINGS_STORAGE_KEY) throw new Error("Invalid settings key");
  if (!navigator.locks)
    throw new Error("Settings update locking is unavailable in this browser");

  return navigator.locks.request(SETTINGS_LOCK, async () => {
    const stored = await storage.getItem<T>(key);
    const current = stored ?? options.fallback;
    if (current === undefined) throw new Error("Settings are unavailable");
    if (
      options.expectedJson !== undefined &&
      JSON.stringify(current) !== options.expectedJson
    ) {
      throw new Error("Settings changed in another window. Review and retry.");
    }
    const next = await update(current);
    await storage.setItem(key, next);
    return next;
  });
}
