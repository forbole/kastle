import { useCallback, useEffect, useState } from "react";
import {
  clearPendingMigration,
  type MigrationBannerStatus,
  readPendingMigration,
  resolvePendingMigration,
  writePendingMigration,
} from "@/lib/kcc20/migration-status";

/**
 * Status of the migration the user last opened the tool for, from this popup.
 *
 * Mobile polls the status API while its in-app browser is open. Here opening
 * the tool closes the popup, so the Bridge CTA persists the pending entry
 * (writePendingMigration) before the tab opens, and each popup open resolves
 * it once: update, or clear when it
 * expired or the payout confirmed. An entry for another address or network is
 * left alone and shows nothing.
 */
export function useKcc20MigrationStatus(
  address: string | undefined,
  network: string,
) {
  const [status, setStatus] = useState<MigrationBannerStatus>();

  useEffect(() => {
    let cancelled = false;
    setStatus(undefined);
    if (!address) return;
    (async () => {
      const entry = await readPendingMigration();
      if (!entry || entry.address !== address || entry.network !== network)
        return;
      const resolved = await resolvePendingMigration(entry, Date.now());
      if (cancelled) return;
      if (resolved.entry) await writePendingMigration(resolved.entry);
      else await clearPendingMigration();
      if (!cancelled) setStatus(resolved.status);
    })().catch(() => {
      // Storage unavailable: nothing is known, nothing is shown.
    });
    return () => {
      cancelled = true;
    };
  }, [address, network]);

  const dismiss = useCallback(async () => {
    setStatus(undefined);
    await clearPendingMigration();
  }, []);

  return { status, dismiss };
}
