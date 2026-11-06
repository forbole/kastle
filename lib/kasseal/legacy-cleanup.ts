// The Kasseal trade route kept open attempts under `local:kasseal_attempts`.
// The route is gone and nothing reads that key, so drop it once from storage.
// WXT strips the `local:` area prefix, so the raw storage key has no prefix.
export const LEGACY_KASSEAL_ATTEMPTS_KEY = "kasseal_attempts";

/** Removes the legacy attempt store. Safe to run again; never throws. */
export async function clearLegacyKassealAttempts(): Promise<void> {
  try {
    await browser.storage.local.remove(LEGACY_KASSEAL_ATTEMPTS_KEY);
  } catch (error) {
    console.warn("Failed to clear legacy Kasseal attempts:", error);
  }
}
