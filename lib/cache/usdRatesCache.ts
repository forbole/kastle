import { storage } from "wxt/storage";

const STORAGE_KEY = "local:cache:usdRates";
const TTL = 10 * 60 * 1000; // 10 min

// Keyless, CORS-open daily fiat rates (github.com/fawazahmed0/exchange-api).
// The jsDelivr URL is the project's documented fallback.
const SOURCES = [
  "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
];

type UsdRates = Record<string, number>; // lowercase code → units per 1 USD
type Cached = { rates: UsdRates; fetchedAt: number };

// ponytail: single-flight per JS context; popups opened in the same 10 min
// read the stored copy, so cross-context dedupe is not worth a lock.
let inflight: Promise<UsdRates> | null = null;

async function fetchUsdRates(): Promise<UsdRates> {
  let lastError: unknown;
  for (const url of SOURCES) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${url}`);
      }
      const { usd } = await response.json();
      if (!usd || typeof usd !== "object") {
        throw new Error(`Unexpected payload: ${url}`);
      }
      return usd;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * USD exchange rates, fetched at most once per 10 minutes. On an upstream
 * error the last stored rates are returned and the store is left as it was.
 */
export async function getUsdRates(): Promise<UsdRates> {
  const cached = await storage.getItem<Cached>(STORAGE_KEY);
  if (cached && Date.now() - cached.fetchedAt < TTL) return cached.rates;

  inflight ??= fetchUsdRates()
    .then(async (rates) => {
      await storage.setItem<Cached>(STORAGE_KEY, {
        rates,
        fetchedAt: Date.now(),
      });
      return rates;
    })
    .catch((error) => {
      if (cached) return cached.rates;
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Force the next getUsdRates() call to fetch upstream. */
export async function invalidateUsdRates(): Promise<void> {
  await storage.removeItem(STORAGE_KEY);
}
