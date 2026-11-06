import { BraidError, BraidL1, BraidRefusal } from "@braid_swap/sdk";
import { BraidSignRefusal } from "@/lib/braid/signer";
import {
  BRAID_API,
  BRAID_INTEGRATOR_FEE,
  BRAID_KASTLE_FEE_BPS,
} from "@/lib/braid/constants";

export const BRAID_FETCH_TIMEOUT_MS = 15_000;

// The SDK's own deadline is 20 s; a client on a bad link gives up sooner. The
// SDK's signal still aborts this request if it fires first.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BRAID_FETCH_TIMEOUT_MS);
  const outer = init?.signal;
  if (outer?.aborted) ac.abort();
  else outer?.addEventListener("abort", () => ac.abort());
  return fetch(input, { ...init, signal: ac.signal }).finally(() =>
    clearTimeout(timer),
  );
};

/** A mainnet Braid client; the integrator block only once a fee address exists. */
export function makeBraid(): BraidL1 {
  const { feeAddress } = BRAID_INTEGRATOR_FEE;
  return new BraidL1({
    network: "mainnet",
    api: BRAID_API.mainnet,
    fetch: fetchWithTimeout,
    ...(feeAddress && BRAID_KASTLE_FEE_BPS > 0
      ? { integrator: { feeAddress, feeBps: BRAID_KASTLE_FEE_BPS } }
      : {}),
  });
}

export const BRAID_UNSUPPORTED_COPY = "Braid doesn't support this pair.";

const RETRYABLE_CODES = new Set(["RATE_LIMITED", "TIMEOUT", "NETWORK", "BUSY"]);

/** User copy for a Braid failure; `fallback` for anything unrecognised. */
export function braidErrorCopy(e: unknown, fallback: string): string {
  if (e instanceof BraidRefusal || e instanceof BraidSignRefusal) {
    return "This swap failed a safety check and was not signed.";
  }
  if (e instanceof BraidError) {
    // The router does not list the token: a product limit, not a failure.
    if (e.code === "UNKNOWN_TOKEN") return BRAID_UNSUPPORTED_COPY;
    if (e.code === "TOO_MANY_NOTES") {
      return "Your balance is split into too many pieces to swap in one go.";
    }
    if (e.status === 429 || (e.code && RETRYABLE_CODES.has(e.code))) {
      return "Braid is busy. Try again in a moment.";
    }
  }
  return fallback;
}
