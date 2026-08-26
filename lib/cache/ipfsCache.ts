import { storage } from "wxt/storage";
import { convertIPFStoHTTP } from "@/lib/utils";

// Permanent cache for content-addressed / immutable JSON (IPFS metadata, KRC721 buri lookups) — never revalidated.
const PREFIX = "local:cache:immutableFetch:";

async function readCache<T>(key: string): Promise<T | null> {
  return (await storage.getItem<T>(`${PREFIX}${key}`)) ?? null;
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  await storage.setItem(`${PREFIX}${key}`, data);
}

export async function fetchImmutable<T>(url: string): Promise<T> {
  const cached = await readCache<T>(url);
  if (cached !== null) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const data = (await res.json()) as T;
  await writeCache(url, data);
  return data;
}

// Same as fetchImmutable, but keyed by the original ipfs:// URL so the cache survives a gateway change.
export async function fetchIPFS<T>(ipfsUrl: string): Promise<T> {
  const cached = await readCache<T>(ipfsUrl);
  if (cached !== null) return cached;

  const httpUrl = convertIPFStoHTTP(ipfsUrl);
  const res = await fetch(httpUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${httpUrl}`);
  const data = (await res.json()) as T;
  await writeCache(ipfsUrl, data);
  return data;
}
