/// <reference types="vite/client" />

/**
 * Local opt-in for Kasseal, for development builds only.
 *
 * Kept in its own module for the same reason as `standardLocalOptIn`: the
 * flag hook is evaluated as CommonJS in `tests/feature-flags-unit.spec.ts`,
 * where `import.meta` cannot appear. The hook stubs this module there.
 */
export function kassealLocalOptIn(): boolean {
  return import.meta.env.VITE_KASSEAL === "1";
}
