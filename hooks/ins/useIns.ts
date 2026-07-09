import useSWR from "swr";
import { fetcher } from "@/lib/utils";

export const INS_API_URL = "https://insdomains.org/api";

export interface InsResolveResponse {
  exists: boolean;
  address?: string;
  owner?: string;
  registry_version?: string;
  tenure?: string;
  expires_at?: string;
}

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
  const fetchDomainOwner = async (
    name: string,
  ): Promise<string | undefined> => {
    try {
      const response = await fetch(
        `${INS_API_URL}/resolve?name=${encodeURIComponent(name)}`,
      );
      if (!response.ok) {
        return undefined;
      }

      const data = (await response.json()) as InsResolveResponse;
      if (!data.exists) {
        return undefined;
      }

      return data.address || undefined;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  };

  return { fetchDomainOwner };
}

export function useInsDomainsByAddress(address?: string) {
  const { data, isLoading, error, mutate } = useSWR<unknown, Error>(
    address ? `${INS_API_URL}/names/by-owner?address=${address}` : null,
    fetcher,
  );

  return { domains: extractDomainNames(data), isLoading, error, mutate };
}

export function useInsResolve(name?: string) {
  const { data, isLoading, error } = useSWR<InsResolveResponse, Error>(
    name ? `${INS_API_URL}/resolve?name=${encodeURIComponent(name)}` : null,
    fetcher,
  );

  return { detail: data?.exists ? data : undefined, isLoading, error };
}
