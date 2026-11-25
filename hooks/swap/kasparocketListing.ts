import { useMemo, useState } from "react";
import useSWR from "swr";
import type { KaspaRocket } from "@kasparocket/sdk";
import { NetworkType } from "@/contexts/SettingsContext";
import { makeKaspaRocket } from "@/lib/kasparocket/client";
import { rocketConfigured } from "@/lib/kasparocket/config";

// A pool, once there, stays; a token without one rarely gains it this fast.
export const KASPAROCKET_POOL_TTL_MS = 10 * 60_000;
export const KASPAROCKET_PROBES_IN_FLIGHT = 5;

type PoolEntry = { pool: string | null; at: number };

// Token id → its pool covenant, or null for a token with none. Module scope,
// so a remount or another key never asks again for a token already answered.
const pools = new Map<string, PoolEntry>();
// Token id → the probe asking for it, from when it is queued until it
// answers. A key change mid-flight waits on it rather than asking again.
const inFlight = new Map<string, Promise<void>>();

/** Forgets every probed pool. Tests only. */
export function clearKaspaRocketPools() {
  pools.clear();
  inFlight.clear();
}

/**
 * Asks for the pool of each token not answered within the TTL and not
 * already being asked for, a few at a time, and waits on those already
 * being asked for. A failed probe leaves its last answer, if any, in place.
 */
async function probePools(client: KaspaRocket, tokenIds: readonly string[]) {
  const now = Date.now();
  const waits = tokenIds.flatMap((id) => {
    const probe = inFlight.get(id);
    return probe ? [probe] : [];
  });
  const queue = tokenIds.filter((id) => {
    if (inFlight.has(id)) return false;
    const known = pools.get(id);
    return !known || now - known.at >= KASPAROCKET_POOL_TTL_MS;
  });
  const answered = new Map<string, () => void>();
  for (const id of queue) {
    inFlight.set(id, new Promise<void>((done) => answered.set(id, done)));
  }
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        // GET <proxy>/api/covenants/by-token/<id>
        const record = await client.catalogue.poolCovenant(id);
        pools.set(id, {
          pool: record?.lp_amm_covenant_id || null,
          at: Date.now(),
        });
      } catch {
        // Unknown stays unknown; the last answer, if any, stands.
      } finally {
        inFlight.delete(id);
        answered.get(id)?.();
      }
    }
  };
  await Promise.all([
    ...Array.from(
      { length: Math.min(KASPAROCKET_PROBES_IN_FLIGHT, queue.length) },
      worker,
    ),
    ...waits,
  ]);
}

/** The listing's SWR key: none (so no probe) while off, unconfigured or off mainnet. */
export function kaspaRocketListingKey(
  networkId: string | undefined,
  enabled: boolean,
  ids: readonly string[],
) {
  return enabled && rocketConfigured() && networkId === NetworkType.Mainnet
    ? (["kasparocketPools", ids.join(",")] as const)
    : null;
}

/**
 * Probes `ids` and answers each one known: its pool, or null for none.
 * Throws while `selectedId` has no answer, so SWR retries the one the screen
 * waits for.
 */
export async function probeKaspaRocketListing(
  client: KaspaRocket,
  ids: readonly string[],
  selectedId: string | undefined,
): Promise<ReadonlyMap<string, string | null>> {
  await probePools(client, ids);
  if (selectedId && !pools.has(selectedId)) {
    throw new Error("KaspaRocket pool probe failed");
  }
  return new Map(
    ids.flatMap((id) => {
      const known = pools.get(id);
      return known ? [[id, known.pool] as const] : [];
    }),
  );
}

/** Tokens with a pool; undefined until `selectedId` has an answer. */
export function kaspaRocketRoutable(
  probed: ReadonlyMap<string, string | null> | undefined,
  selectedId: string | undefined,
): ReadonlySet<string> | undefined {
  if (!probed || (selectedId && !probed.has(selectedId))) return undefined;
  return new Set(
    Array.from(probed).flatMap(([id, pool]) => (pool ? [id] : [])),
  );
}

/**
 * `L1Listings.kasparocket`: token ids KaspaRocket has a pool for, among
 * `heldIds` and `selectedId`. Only those are probed, never the whole
 * catalogue. Undefined while off, off mainnet, or until `selectedId` has an
 * answer: KaspaRocket then does not route the pair, and "no route" is not
 * claimed for it. A build with no proxy token is off: no probe, no retry.
 */
export function useKaspaRocketListing(
  networkId: string | undefined,
  enabled: boolean,
  heldIds: readonly string[],
  selectedId: string | undefined,
): ReadonlySet<string> | undefined {
  const [client] = useState(() => makeKaspaRocket());
  const ids = useMemo(
    () =>
      Array.from(
        new Set(selectedId ? [...heldIds, selectedId] : heldIds),
      ).sort(),
    [heldIds, selectedId],
  );
  const { data } = useSWR(
    kaspaRocketListingKey(networkId, enabled, ids),
    () => probeKaspaRocketListing(client, ids, selectedId),
    { refreshInterval: KASPAROCKET_POOL_TTL_MS, revalidateOnFocus: false },
  );
  return useMemo(
    () => kaspaRocketRoutable(data, selectedId),
    [data, selectedId],
  );
}

/**
 * The pool covenant of one token, from the same probe and table as
 * useKaspaRocketListing: null when it has none, undefined while unknown.
 */
export function useKaspaRocketPool(
  client: KaspaRocket,
  enabled: boolean,
  tokenId: string | undefined,
) {
  const { data, error, isLoading } = useSWR(
    enabled && rocketConfigured() && tokenId
      ? ["kasparocketPool", tokenId]
      : null,
    async () => {
      await probePools(client, [tokenId!]);
      const known = pools.get(tokenId!);
      if (!known) throw new Error("KaspaRocket pool probe failed");
      return known.pool;
    },
    { refreshInterval: KASPAROCKET_POOL_TTL_MS, revalidateOnFocus: false },
  );
  return {
    pool: data,
    error: data === undefined ? error : undefined,
    isLoading,
  };
}
