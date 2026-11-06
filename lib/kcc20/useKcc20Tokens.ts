import { useContext, useEffect, useState } from "react";
import useSWR from "swr";
import { storage } from "wxt/storage";
import { useSettings } from "@/hooks/useSettings.ts";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import { RpcClientContext } from "@/contexts/RpcClientContext.tsx";
import { restApis } from "@/components/screens/Settings";
import {
  fetchKcc20Tokens,
  KRON_HOSTS,
  Kcc20Token,
  Kcc20Tokens,
} from "@/lib/kcc20";

// JSON has no bigint, so amounts are stored as decimal strings.
type StoredToken = Omit<Kcc20Token, "amount" | "spendable"> & {
  amount: string;
  spendable: string;
};

// Network first, so a testnet set is never read back on mainnet.
const holdingsKey = (network: string, address: string) =>
  `local:cache:kcc20Holdings:${network}:${address}` as const;

/** The last complete scan stored for `address` on `network`, if any. */
export async function loadKcc20Holdings(
  network: string,
  address: string,
): Promise<Kcc20Tokens | undefined> {
  const stored = await storage.getItem<StoredToken[]>(
    holdingsKey(network, address),
  );
  if (!stored) return undefined;
  return {
    tokens: stored.map((t) => ({
      ...t,
      amount: BigInt(t.amount),
      spendable: BigInt(t.spendable),
    })),
    legacyUnavailable: false,
  };
}

/**
 * Stores a scan only when it is complete: a partial one would drop the legacy
 * rows from the stored set. A failed scan throws before it reaches here.
 */
export async function persistKcc20Holdings(
  network: string,
  address: string,
  scan: Kcc20Tokens,
): Promise<void> {
  if (scan.legacyUnavailable) return;
  await storage.setItem<StoredToken[]>(
    holdingsKey(network, address),
    scan.tokens.map((t) => ({
      ...t,
      amount: t.amount.toString(),
      spendable: t.spendable.toString(),
    })),
  );
}

/** Scans, then stores the result; a throw leaves the stored set as it was. */
export async function scanKcc20Holdings(
  network: string,
  address: string,
  scan: () => Promise<Kcc20Tokens>,
): Promise<Kcc20Tokens> {
  const result = await scan();
  // A storage failure must not fail the scan the dashboard already has.
  await persistKcc20Holdings(network, address, result).catch(() => {});
  return result;
}

export default function useKcc20Tokens(address?: string) {
  const [settings] = useSettings();
  const { rpcClient } = useContext(RpcClientContext);
  const { isKcc20StandardEnabled } = useFeatureFlags();
  const network = settings?.networkId;
  // Stored settings may carry a network KRON does not serve: no fetch.
  const enabled = address && rpcClient && network && network in KRON_HOSTS;
  const [stored, setStored] = useState<{
    id: string;
    holdings?: Kcc20Tokens;
  }>();
  const storedId = enabled ? `${network}:${address}` : undefined;

  // A cold start shows the last complete scan until this one answers.
  useEffect(() => {
    if (!storedId || stored?.id === storedId) return;
    let active = true;
    loadKcc20Holdings(network!, address!)
      .catch(() => undefined)
      .then((holdings) => {
        if (active) setStored({ id: storedId, holdings });
      });
    return () => {
      active = false;
    };
  }, [storedId, stored, network, address]);

  const { data, error, isLoading } = useSWR(
    // Network in the key so a switch never shows the other network's rows.
    enabled ? ["kcc20Tokens", network, address, isKcc20StandardEnabled] : null,
    () =>
      scanKcc20Holdings(network!, address!, () =>
        fetchKcc20Tokens(address!, rpcClient!, restApis[network!], {
          standard: isKcc20StandardEnabled,
          network,
        }),
      ),
    {
      refreshInterval: 30_000,
      // Only the set stored under this network and address may stand in.
      fallbackData: stored?.id === storedId ? stored?.holdings : undefined,
    },
  );
  return {
    data: data?.tokens,
    // Flag on: legacy rows failed to load, so `data` holds standard rows only.
    legacyUnavailable: data?.legacyUnavailable ?? false,
    error,
    isLoading,
  };
}
