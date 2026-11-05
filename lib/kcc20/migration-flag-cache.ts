// Last delivered values of the migration flags, so a popup opened before
// PostHog answers (or with PostHog unreachable) keeps the route the user saw.
// Its own module so the flag hook's unit spec can stub browser storage.

export const MIGRATION_ROUTE_CACHE_KEY = "feature_flag_kcc20_migration_route";
export const MIGRATION_PAYLOAD_CACHE_KEY = "feature_flag_kcc20_migration";

export type MigrationFlagCache = { route: boolean; payload: unknown };

export async function readMigrationFlagCache(): Promise<MigrationFlagCache> {
  const stored = await browser.storage.local.get([
    MIGRATION_ROUTE_CACHE_KEY,
    MIGRATION_PAYLOAD_CACHE_KEY,
  ]);
  return {
    route: stored[MIGRATION_ROUTE_CACHE_KEY] === true,
    payload: stored[MIGRATION_PAYLOAD_CACHE_KEY] ?? undefined,
  };
}

export async function writeMigrationFlagCache({
  route,
  payload,
}: MigrationFlagCache) {
  await browser.storage.local.set({
    [MIGRATION_ROUTE_CACHE_KEY]: route,
    [MIGRATION_PAYLOAD_CACHE_KEY]: payload ?? null,
  });
}
