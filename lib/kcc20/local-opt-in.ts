/// <reference types="vite/client" />

/**
 * Local opt-in for KCC-20 standard rows, for development builds only.
 *
 * Kept in its own module because the flag hook is evaluated as CommonJS in
 * `tests/feature-flags-unit.spec.ts`; `import.meta` cannot appear in that
 * source. The hook stubs this module there.
 */
export function standardLocalOptIn(): boolean {
  return import.meta.env.VITE_KCC20_STANDARD === "1";
}

/**
 * Local opt-in for the KRC-20 → KCC-20 migration route, development builds
 * only. VITE_KCC20_MIGRATION_PAYLOAD optionally carries the `kcc20_migration`
 * payload as JSON, so the route can be tested before the PostHog flag exists.
 */
export function migrationLocalOptIn(): boolean {
  return import.meta.env.VITE_KCC20_MIGRATION === "1";
}

export function migrationLocalPayload(): unknown {
  const raw = import.meta.env.VITE_KCC20_MIGRATION_PAYLOAD;
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
