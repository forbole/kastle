import {
  fetchAllSwapHistory,
  SwapHistoryDegradation,
} from "@/lib/activity/swap-history";
import {
  type ActivityPageType,
  BRIDGE_TRANSFER_ACTIVITY_TYPE,
  IGRA_DEPOSIT_ACTIVITY_TYPE,
  KURVE_BRIDGE_ACTIVITY_TYPE,
} from "@/lib/activity/mappers";
import { fetchKatBridgeHistory } from "@/lib/bridge/kat-bridge-history";
import { fetchIgraDeposits } from "@/lib/bridge/igra-deposit-history";
import { IGRA_ENTRY_ADDRESS } from "@/lib/bridge/bridge";
import {
  fetchKurveRegistry,
  mergeKurveHistory,
} from "@/lib/bridge/kat-registry";
import { readLocalKurveRecords } from "@/lib/bridge/kurve-local-history";
import { attachIgraCredits } from "@/lib/bridge/igra-credits";
import { applyKurveCompletions } from "@/lib/activity/kurve-completion";
import { attachKurveKastleFees } from "@/lib/bridge/kat-observed-fees";
import { ActivitySourceItem } from "@/lib/activity/types";

/**
 * The activity feed's SWR fetcher (useActivityFeed), as a plain function so
 * scripts/perf/measure.mjs replays exactly the code the popup runs.
 *
 * Each page reads only its own sources — swaps for Swap, KAT + Igra + Kurve
 * for Bridge — so neither page waits on the other's slowest upstream.
 */
export async function fetchActivityFeed({
  page,
  sender,
  kaspaAddress,
  forceIgra,
}: {
  page: ActivityPageType;
  sender: string | undefined;
  kaspaAddress: string | undefined;
  forceIgra: boolean;
}) {
  // Independent sources, run together: wall-clock is the slowest one, not
  // the sum (mobile measured 11.2 s sequential). Each bounds its own
  // requests, so this await always settles.
  const swaps = page === "swap";
  const bridge = page === "bridge";
  const [swapHistory, kurve, katHistory, igraDeposits] = await Promise.all([
    // Both mainnet L2s — the same EVM key signs on each. Never throws;
    // each chain degrades on its own.
    swaps && sender
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
      if (!bridge) return { rows: [], truncated: false };
      const wallets = [
        ...new Set([sender, kaspaAddress].filter(Boolean)),
      ] as string[];
      const local = await readLocalKurveRecords(wallets).catch(() => []);
      const pages = (
        await Promise.all(wallets.map((w) => fetchKurveRegistry(w)))
      ).filter((r) => r !== null);
      const remote = pages.flatMap((p) => p.rows);
      return {
        rows: await attachKurveKastleFees(
          await applyKurveCompletions(mergeKurveHistory(local, remote), {
            kaspaAddress: kaspaAddress ?? null,
            evmAddress: sender ?? null,
          }),
        ),
        truncated: pages.some((p) => p.truncated),
      };
    })(),
    // KAT's wallet-scoped history needs BOTH addresses: deposits come
    // back for the L1 wallet, withdrawals for the L2 wallet, never both
    // from one call.
    bridge
      ? fetchKatBridgeHistory({ kaspaAddress, evmAddress: sender })
      : { txs: [], degraded: null },
    // Igra's KAS → iKAS lane mints without an L2 tx, so neither KAT nor
    // any L2 list sees it — reconstructed from the L1 lane payload.
    // L1 acceptance is not delivery: each deposit carries Igra's own
    // credit observation, which is what completes the row.
    bridge
      ? fetchIgraDeposits({
          kaspaAddress,
          entryAddress: IGRA_ENTRY_ADDRESS.mainnet,
          force: forceIgra,
        }).then(async (r) => ({
          ...r,
          deposits: await attachIgraCredits(r.deposits),
        }))
      : { deposits: [], ok: true, truncated: false },
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
    ...kurve.rows.map((data) => ({
      type: KURVE_BRIDGE_ACTIVITY_TYPE,
      data,
    })),
  ];

  return {
    // Swap rows join outside the fetcher, with the KCC-20 family.
    items,
    swapHistory,
    bridgeSource: katHistory.degraded,
    // Unreadable L1 and a scan stopped at its horizon are different
    // states; one token would misreport one as the other.
    depositSource: !igraDeposits.ok
      ? ("igra_deposits_unavailable" as const)
      : igraDeposits.truncated
        ? ("igra_deposits_partial" as const)
        : null,
    kurveSource: kurve.truncated ? ("kurve_registry_partial" as const) : null,
  };
}

export type ActivityFeedData = Awaited<ReturnType<typeof fetchActivityFeed>>;
