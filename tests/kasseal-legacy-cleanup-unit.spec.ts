import { test, expect } from "@playwright/test";
import {
  LEGACY_KASSEAL_ATTEMPTS_KEY,
  clearLegacyKassealAttempts,
} from "../lib/kasseal/legacy-cleanup";

test("clears the legacy Kasseal attempt store once and never throws", async () => {
  const data: Record<string, unknown> = {
    [LEGACY_KASSEAL_ATTEMPTS_KEY]: { "mainnet:kaspa:abc:cov": { step: 1 } },
    braid_pending_swaps: { swaps: {}, claims: {} },
  };
  const local = {
    async remove(key: string) {
      delete data[key];
    },
  };
  (globalThis as any).browser = { storage: { local } };

  await clearLegacyKassealAttempts();
  expect(LEGACY_KASSEAL_ATTEMPTS_KEY in data).toBe(false);
  expect(data.braid_pending_swaps).toBeDefined();

  await expect(clearLegacyKassealAttempts()).resolves.toBeUndefined();

  local.remove = async () => {
    throw new Error("storage unavailable");
  };
  await expect(clearLegacyKassealAttempts()).resolves.toBeUndefined();
});
