import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { assembleActivityFeed } from "@/lib/activity/feed";
import {
  mergeKcc20SwapHistory,
  SwapHistoryDegradation,
} from "@/lib/activity/swap-history";
import { useKcc20SwapHistory } from "@/hooks/useKcc20SwapHistory";
import {
  type ActivityPageType,
  SWAP_ACTIVITY_TYPE,
} from "@/lib/activity/mappers";
import type { BridgeHistoryDegradation } from "@/lib/bridge/kat-bridge-history";
import type { IgraDepositDegradation } from "@/lib/bridge/igra-deposit-history";
import type { KurveRegistryDegradation } from "@/lib/bridge/kat-registry";
import {
  type ActivityFeedData,
  fetchActivityFeed,
} from "@/lib/activity/fetch-feed";
import { storeActivity, useStoredActivity } from "@/lib/activity/feed-store";
import { isInProgress } from "@/lib/activity/adapters";

/**
 * 10 s while any row is still moving, 60 s once everything has settled.
 * Reads the data SWR hands it (not the rendered rows), so the first poll
 * after a fetch that turned up a pending row already runs at 10 s.
 * KCC-20 rows poll on their own entry (useKcc20SwapHistory).
 */
function pollInterval(data?: ActivityFeedData): number {
  if (!data) return 10_000;
  const rows = assembleActivityFeed([
    ...data.items,
    ...data.swapHistory.swaps.map((swap) => ({
      type: SWAP_ACTIVITY_TYPE,
      data: swap,
    })),
  ]);
  return rows.some(isInProgress) ? 10_000 : 60_000;
}

/**
 * Swap + bridge activity feed, ported from kastle-mobile
 * hooks/activity/useActivityFeed.ts. Mainnet-only, like mobile: every source
 * below reads mainnet explorers/registries.
 *
 * Mobile merges five sources; this has four. The fifth — Igra exits read from
 * a local exit log, with payout matching and refund probes — exists only
 * because the mobile bridge writes that log on submit. The extension bridge
 * writes no exit log (only the Kurve backup, kurve-local-history.ts), so its
 * Igra exits reach this feed through KAT's own history instead
 * (fetchKatBridgeHistory covers both directions).
 */
export function useActivityFeed(enabled: boolean, page: ActivityPageType) {
  const sender = useEvmAddress();
  const { account } = useWalletManager();
  const kaspaAddress = account?.address;
  // Igra's deposit scan is the one source with a cache (60 s / 10 s head TTL);
  // a manual refresh forces just its head-check. Consumed once per run.
  const forceRef = useRef(false);
  // Spinner for the manual refresh only — NOT isValidating, which also goes
  // true on every 10 s background poll.
  const [isRefreshing, setIsRefreshing] = useState(false);
  // KCC-20 swaps (Kaspa L1, kascov) arrive on their own SWR entry and are
  // merged below, so kascov loading or failing never holds back these rows.
  // Swap page only, like the EVM swaps (fetchActivityFeed).
  const kcc20 = useKcc20SwapHistory(kaspaAddress, enabled && page === "swap");

  // The last feed this wallet pair showed, painted while the live read runs.
  const storeId = enabled ? `${page}:${sender}:${kaspaAddress}` : undefined;
  const stored = useStoredActivity<ActivityFeedData>("feed", storeId);

  const { data, error, isLoading, mutate } = useSWR(
    // Page in the key: each page has its own entry, so neither waits on the other.
    enabled ? ["activity-feed", page, sender, kaspaAddress] : null,
    async () => {
      const force = forceRef.current;
      forceRef.current = false;
      const feed = await fetchActivityFeed({
        page,
        sender,
        kaspaAddress,
        force,
      });
      storeActivity("feed", `${page}:${sender}:${kaspaAddress}`, feed);
      return feed;
    },
    {
      refreshInterval: pollInterval,
      dedupingInterval: 5_000,
      fallbackData: stored,
    },
  );
  // SWR's isLoading ignores fallbackData: data here while loading is the
  // stored copy, so its statuses may be seconds old until this read lands.
  const feedStale = isLoading && data !== undefined;
  const isStale = feedStale || kcc20.stale;

  const merged = useMemo(() => {
    if (!data) return null;
    const swaps = mergeKcc20SwapHistory(data.swapHistory, kcc20.family);
    return {
      rows: assembleActivityFeed([
        ...data.items,
        ...swaps.swaps.map((swap) => ({
          type: SWAP_ACTIVITY_TYPE,
          data: swap,
        })),
      ]),
      swapSource: swaps.degraded,
    };
  }, [data, kcc20.family]);

  return {
    rows: merged?.rows ?? null,
    /** Degradation tokens — a gap the user must be told about, never hidden. */
    swapSource: (merged?.swapSource?.length ? merged.swapSource : null) as
      | SwapHistoryDegradation
      | SwapHistoryDegradation[]
      | null,
    bridgeSource: (data?.bridgeSource ??
      null) as BridgeHistoryDegradation | null,
    depositSource: (data?.depositSource ??
      null) as IgraDepositDegradation | null,
    kurveSource: (data?.kurveSource ?? null) as KurveRegistryDegradation | null,
    error,
    isLoading,
    /** Rows are the stored copy; the live read has not answered yet. */
    isStale,
    // The existing refresh spinner also runs while stored rows revalidate.
    isRefreshing: isRefreshing || isStale,
    refresh: () => {
      forceRef.current = true;
      setIsRefreshing(true);
      // Bound to THIS revalidation, so a background poll settling mid-refresh
      // can't clear the spinner early; catch() because mutate() rethrows.
      return Promise.all([mutate(), kcc20.refresh()])
        .catch(() => undefined)
        .finally(() => setIsRefreshing(false));
    },
  };
}
