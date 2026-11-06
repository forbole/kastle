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
