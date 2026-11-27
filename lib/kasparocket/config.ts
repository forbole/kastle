// Kastle reaches KaspaRocket only through its own proxy, which holds the
// vendor key and forwards an allowlist. The app-side token below is public by
// design (allowlist + per-IP limit defend it) but still arrives by env var.
// Its own module: tests/feature-flags-unit.spec.ts evaluates the flag hook as
// CommonJS, where `import.meta` cannot appear, so that spec stubs this file.

export const ROCKET_PROXY_URL =
  "https://kastle-rocket-proxy.leo-braga95.workers.dev";

// `?.`: outside Vite (the Node specs) `import.meta.env` is undefined.
export const ROCKET_PROXY_TOKEN: string =
  import.meta.env?.VITE_KASPAROCKET_PROXY_TOKEN ?? "";

/** Whether the build carries the proxy token; without one KaspaRocket is off. */
export function rocketConfigured(): boolean {
  return ROCKET_PROXY_TOKEN.trim() !== "";
}

export const KASPAROCKET_PROVIDER = {
  id: "kasparocket",
  name: "KaspaRocket",
} as const;

// The most covenant inputs (coins carrying a covenant id: token cells, the
// pool) one KaspaRocket transaction spends: protocol()'s `limits.maxCovIns`
// and `maxKcc20Inputs`, both 10. A sell whose holding is split across more
// cells must be merged first. Plain KAS coins do not count: a buy may spend
// as many as the plan carries.
export const KASPAROCKET_MAX_COVENANT_INPUTS = 10;
