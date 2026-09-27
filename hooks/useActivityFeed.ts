import { useRef, useState } from "react";
import useSWR from "swr";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { assembleActivityFeed } from "@/lib/activity/feed";
import {
  fetchAllSwapHistory,
  SwapHistoryDegradation,
} from "@/lib/activity/swap-history";
import {
  BRIDGE_TRANSFER_ACTIVITY_TYPE,
  IGRA_DEPOSIT_ACTIVITY_TYPE,
  KURVE_BRIDGE_ACTIVITY_TYPE,
  SWAP_ACTIVITY_TYPE,
} from "@/lib/activity/mappers";
import {
  BridgeHistoryDegradation,
  fetchKatBridgeHistory,
} from "@/lib/bridge/kat-bridge-history";
import {
  fetchIgraDeposits,
  IgraDepositDegradation,
} from "@/lib/bridge/igra-deposit-history";
import { IGRA_ENTRY_ADDRESS } from "@/lib/bridge/bridge";
import {
  fetchKurveRegistry,
  KurveRegistryRecord,
  mergeKurveHistory,
} from "@/lib/bridge/kat-registry";
import { readLocalKurveRecords } from "@/lib/bridge/kurve-local-history";
import { applyKurveCompletions } from "@/lib/activity/kurve-completion";
import { attachKurveKastleFees } from "@/lib/bridge/kat-observed-fees";
import { ActivitySourceItem } from "@/lib/activity/types";

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
export function useActivityFeed(enabled: boolean) {
  const sender = useEvmAddress();
  const { account } = useWalletManager();
  const kaspaAddress = account?.address;
  // Igra's deposit scan is the one source with a cache (60 s / 10 s head TTL);
  // a manual refresh forces just its head-check. Consumed once per run.
  const forceIgraRef = useRef(false);
  // Spinner for the manual refresh only — NOT isValidating, which also goes
  // true on every 10 s background poll.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ["activity-feed", sender, kaspaAddress] : null,
    async () => {
      const forceIgra = forceIgraRef.current;
      forceIgraRef.current = false;

      // Independent sources, run together: wall-clock is the slowest one, not
      // the sum (mobile measured 11.2 s sequential). Each bounds its own
      // requests, so this await always settles.
      const [swapHistory, kurveRows, katHistory, igraDeposits] =
        await Promise.all([
          // Both mainnet L2s — the same EVM key signs on each. Never throws;
          // each chain degrades on its own.
          sender
            ? fetchAllSwapHistory(sender)
            : Promise.resolve({
                swaps: [],
                degraded: [] as SwapHistoryDegradation[],
              }),
          // Kurve (Kaspa ↔ Kasplex): KAT's self-reported registry, queried by
          // both wallets (deposits key on the kaspa sender OR evm recipient,
          // exits the reverse), over the local broadcast backup that keeps
          // rows alive when a POST failed or the registry is down. The
          // registry never completes Kastle-posted rows, so PENDING rows are
          // upgraded from on-chain settlement.
          (async () => {
            const wallets = [
              ...new Set([sender, kaspaAddress].filter(Boolean)),
            ] as string[];
            const local = await readLocalKurveRecords(wallets).catch(() => []);
            const remote = (
              await Promise.all(wallets.map((w) => fetchKurveRegistry(w)))
            )
              .filter((r): r is KurveRegistryRecord[] => r !== null)
              .flat();
            return attachKurveKastleFees(
              await applyKurveCompletions(mergeKurveHistory(local, remote), {
                kaspaAddress: kaspaAddress ?? null,
                evmAddress: sender ?? null,
              }),
            );
          })(),
          // KAT's wallet-scoped history needs BOTH addresses: deposits come
          // back for the L1 wallet, withdrawals for the L2 wallet, never both
          // from one call.
          fetchKatBridgeHistory({ kaspaAddress, evmAddress: sender }),
          // Igra's KAS → iKAS lane mints without an L2 tx, so neither KAT nor
          // any L2 list sees it — reconstructed from the L1 lane payload.
          fetchIgraDeposits({
            kaspaAddress,
            entryAddress: IGRA_ENTRY_ADDRESS.mainnet,
            force: forceIgra,
          }),
        ]);

      const items: ActivitySourceItem[] = [
        ...katHistory.txs.map((data) => ({
          type: BRIDGE_TRANSFER_ACTIVITY_TYPE,
          data,
        })),
        ...igraDeposits.deposits.map((data) => ({
          type: IGRA_DEPOSIT_ACTIVITY_TYPE,
          data,
        })),
        ...kurveRows.map((data) => ({ type: KURVE_BRIDGE_ACTIVITY_TYPE, data })),
        ...swapHistory.swaps.map((data) => ({ type: SWAP_ACTIVITY_TYPE, data })),
      ];

      return {
        rows: assembleActivityFeed(items),
        swapSource: swapHistory.degraded,
        bridgeSource: katHistory.degraded,
        // Unreadable L1 and a scan stopped at its horizon are different
        // states; one token would misreport one as the other.
        depositSource: !igraDeposits.ok
          ? ("igra_deposits_unavailable" as const)
          : igraDeposits.truncated
            ? ("igra_deposits_partial" as const)
            : null,
      };
    },
    { refreshInterval: 10_000, dedupingInterval: 5_000 },
  );

  return {
    rows: data?.rows ?? null,
    /** Degradation tokens — a gap the user must be told about, never hidden. */
    swapSource: (data?.swapSource?.length ? data.swapSource : null) as
      | SwapHistoryDegradation
      | SwapHistoryDegradation[]
      | null,
    bridgeSource: (data?.bridgeSource ??
      null) as BridgeHistoryDegradation | null,
    depositSource: (data?.depositSource ??
      null) as IgraDepositDegradation | null,
    error,
    isLoading,
    isRefreshing,
    refresh: () => {
      forceIgraRef.current = true;
      setIsRefreshing(true);
      // Bound to THIS revalidation, so a background poll settling mid-refresh
      // can't clear the spinner early; catch() because mutate() rethrows.
      return mutate()
        .catch(() => undefined)
        .finally(() => setIsRefreshing(false));
    },
  };
}
