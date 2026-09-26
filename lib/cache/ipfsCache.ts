import { storage } from "wxt/storage";

// Lives here rather than in lib/utils so this module stays importable from a
// node test: utils pulls SettingsContext, which pulls the network-logo SVGs.
export function convertIPFStoHTTP(url: string) {
  return url.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/");
}

// Permanent cache for content-addressed / immutable JSON (IPFS metadata, KRC721 buri lookups) — never revalidated.
const PREFIX = "local:cache:immutableFetch:";

async function readCache<T>(key: string): Promise<T | null> {
  return (await storage.getItem<T>(`${PREFIX}${key}`)) ?? null;
}

// Write-behind: by the time this runs the network call has already succeeded,
// so a storage failure (quota, the store is unbounded and shares the 10 MB
// storage.local budget with wallet state) must not reject the fetch — that
// turned a full cache into a vanished card.
function writeCache<T>(key: string, data: T): void {
  void storage.setItem(`${PREFIX}${key}`, data).catch(() => {});
}

export async function fetchImmutable<T>(url: string): Promise<T> {
  const cached = await readCache<T>(url);
  if (cached !== null) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const data = (await res.json()) as T;
  writeCache(url, data);
  return data;
}

// Collections lay their token metadata out as either `{buri}/{id}` or
// `{buri}/{id}.json` (KSPR is the latter, and never rendered before this).
// The winning suffix is remembered per buri, and while the first token of a
// collection is still probing, the rest of the page waits for its verdict
// rather than each paying a 5 s 404 of their own.
type Layout = "" | ".json";
const probes = new Map<string, Promise<Layout | null>>();

async function probeLayout(
  buri: string,
  id: string,
): Promise<[Layout, Response]> {
  const url = convertIPFStoHTTP(`${buri}/${id}`);
  const res = await fetch(url);
  // Only a 404 means "wrong layout". Anything else is the gateway's problem,
  // and a second request would just double its load.
  if (res.status !== 404) return ["", res];
  return [".json", await fetch(`${url}.json`)];
}

export async function fetchIPFSMetadata<T>(
  buri: string,
  id: string,
): Promise<T> {
  const key = `${buri}/${id}`;
  const cached = await readCache<T>(key);
  if (cached !== null) return cached;

  let suffix = await readCache<Layout>(`layout:${buri}`);
  let res: Response | undefined;
  while (suffix === null) {
    // A failed probe settles to null and the waiters loop round to probe for
    // themselves. No await between the get and the set, or every card on the
    // page registers its own probe.
    const inflight = probes.get(buri);
    if (inflight) {
      suffix = await inflight;
      continue;
    }
    const probe = probeLayout(buri, id);
    probes.set(
      buri,
      probe
        .then(([s, r]) => (r.ok ? s : null))
        .catch(() => null)
        .finally(() => probes.delete(buri)),
    );
    [suffix, res] = await probe;
    if (res.ok) writeCache(`layout:${buri}`, suffix);
  }

  res ??= await fetch(convertIPFStoHTTP(key + suffix));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${key}${suffix}`);
  const data = (await res.json()) as T;
  writeCache(key, data);
  return data;
}
