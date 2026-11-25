import { KaspaRocket, KaspaRocketError } from "@kasparocket/sdk";
import { ROCKET_PROXY_TOKEN, ROCKET_PROXY_URL } from "./config";

export const KASPAROCKET_FETCH_TIMEOUT_MS = 15_000;

/**
 * The mainnet KaspaRocket client, through Kastle's proxy: the proxy holds the
 * vendor key and answers `/pro-api/*` and `/api/tokens` as KaspaRocket does,
 * so the SDK takes it as both `apiUrl` and `catalogueUrl` unchanged. `apiKey`
 * is the proxy's app-side token, never the vendor key. Without one the proxy
 * refuses everything, so no request leaves at all.
 */
export function makeKaspaRocket({
  apiKey = ROCKET_PROXY_TOKEN,
  baseUrl = ROCKET_PROXY_URL,
}: { apiKey?: string; baseUrl?: string } = {}): KaspaRocket {
  const root = baseUrl.replace(/\/$/, "");
  // The SDK's own deadline is 30 s; give up sooner. The SDK's signal still
  // aborts the request if it fires first. No `Origin` stripping as on mobile:
  // a browser always sends it, and the proxy rebuilds upstream headers.
  const fetchWithTimeout: typeof fetch = (input, init) => {
    if (!apiKey.trim()) {
      return Promise.reject(new Error("KaspaRocket is not configured"));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), KASPAROCKET_FETCH_TIMEOUT_MS);
    const outer = init?.signal;
    if (outer?.aborted) ac.abort();
    else outer?.addEventListener("abort", () => ac.abort());
    return fetch(input, { ...init, signal: ac.signal }).finally(() =>
      clearTimeout(timer),
    );
  };
  return new KaspaRocket({
    network: "mainnet",
    apiUrl: `${root}/pro-api`,
    catalogueUrl: root,
    ...(apiKey ? { apiKey } : {}),
    fetch: fetchWithTimeout,
  });
}

/**
 * What to tell the user about a KaspaRocket failure: the server's own words
 * for a request it refused, `fallback` for anything that never reached it
 * or failed on the way (timeout, node down, rate limit).
 */
export function kaspaRocketErrorCopy(e: unknown, fallback: string): string {
  if (!(e instanceof KaspaRocketError) || !e.message) return fallback;
  return e.kind === "invalid_request" ||
    e.kind === "conflict" ||
    e.kind === "unsupported"
    ? e.message
    : fallback;
}
