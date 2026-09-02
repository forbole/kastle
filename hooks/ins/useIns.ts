import useSWR from "swr";
import { useEffect, useState } from "react";
import { insDomainsCache } from "@/lib/cache/insDomainsCache";

export const INS_API_URL = "https://insdomains.org/api";

// Two budgets, not one. /resolve is sub-second and sits in the send-form
// validator, so it needs a tight ceiling. /names/by-owner is a server-side
// O(n) scan with no pagination and legitimately takes ~30s -- a timeout tight
// enough for /resolve would break the names grid outright.
const RESOLVE_TIMEOUT_MS = 8_000;
const BY_OWNER_TIMEOUT_MS = 45_000;

export interface InsResolveResponse {
  exists: boolean;
  /** resolve()/targetOf -- a routing pointer, NOT proof of ownership. */
  address?: string;
  owner?: string;
  /** Decimal string in the payload, e.g. "39". V1 and V2 ids are namespaced separately. */
  tokenId?: string;
  registry_version?: string;
  tenure?: string;
  /** Unix seconds, or null for a Forever name. */
  expires_at?: number | null;
}

const timeoutFetcher = (timeoutMs: number) => (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json());

function extractDomainNames(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) =>
      typeof entry === "string" ? entry : (entry?.name ?? entry?.domain),
    );
  }

  const container = raw as
    | { names?: unknown[]; domains?: unknown[]; data?: unknown[] }
    | undefined;

  return extractDomainNames(
    container?.names ?? container?.domains ?? container?.data ?? [],
  );
}

export function useIns() {
  // Fast display layer only. The send destination is decided by the on-chain
  // check in lib/ins/insRegistry.ts -- never by this record's `address`, which
  // is targetOf and goes stale the moment a name is transferred.
  const fetchInsRecord = async (
    name: string,
  ): Promise<InsResolveResponse | undefined> => {
    try {
      const response = await fetch(
        `${INS_API_URL}/resolve?name=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) },
      );
      if (!response.ok) {
        return undefined;
      }

      const data = (await response.json()) as InsResolveResponse;
      if (!data.exists) {
        return undefined;
      }

      return data;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  };

  return { fetchInsRecord };
}

export function useInsDomainsByAddress(address?: string) {
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    if (!address) return;
    insDomainsCache.load(address).then(() => setCacheReady(true));
  }, [address]);

  const cached = address ? insDomainsCache.read(address) : null;

  const { data, isLoading, error, mutate } = useSWR<unknown, Error>(
    address ? `${INS_API_URL}/names/by-owner?address=${address}` : null,
    timeoutFetcher(BY_OWNER_TIMEOUT_MS),
    {
      fallbackData: cacheReady && cached != null ? cached : undefined,
      keepPreviousData: true,
      onSuccess: (raw) => {
        if (address) insDomainsCache.write(address, extractDomainNames(raw));
      },
    },
  );

  return { domains: extractDomainNames(data), isLoading, error, mutate };
}

export function useInsResolve(name?: string) {
  const { data, isLoading, error } = useSWR<InsResolveResponse, Error>(
    name ? `${INS_API_URL}/resolve?name=${encodeURIComponent(name)}` : null,
    timeoutFetcher(RESOLVE_TIMEOUT_MS),
  );

  return { detail: data?.exists ? data : undefined, isLoading, error };
}
