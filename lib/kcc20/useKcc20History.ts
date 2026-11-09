import { useMemo } from "react";
import useSWRInfinite from "swr/infinite";
import { NetworkType } from "@/contexts/SettingsContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import type { Kcc20Family, Kcc20Token } from "@/lib/kcc20";
import {
  attributeFromEventLog,
  DaaTip,
  eventEntries,
  ownerStrings,
  standardOwnerKey,
  toHistoryEntries,
} from "@/lib/kcc20/history";
import {
  KascovTokenEvent,
  KascovTransfer,
  KascovTransferCursor,
  fetchOwnerTransfers,
  fetchStandardHoldingsWithTip,
  fetchTokenEvents,
} from "@/lib/kcc20/providers/kascov";

// The events log has no owner filter: 43 events for one token, 8173 for another.
// Two pages is what the fallback may spend; past that, history stops.
export const EVENTS_FALLBACK_PAGE_CAP = 2;

type HistoryPage = (
  | {
      source: "transfers";
      // The owner string page 1 found rows under; later pages stay on it.
      owner: string;
      rows: KascovTransfer[];
      next?: KascovTransferCursor;
    }
  | {
      source: "events";
      // Already narrowed to the wallet's owner strings.
      events: KascovTokenEvent[];
      eventsPage: number;
      nextBeforeSeq?: number;
    }
) & {
  // Page 1 only: kascov's tip when it read the holdings; every page dates from it.
  tip?: DaaTip;
};

type HistoryKey =
  | readonly [string, string, string, string, "first"]
  | readonly [
      string,
      string,
      string,
      string,
      "transfers",
      string,
      KascovTransferCursor,
    ]
  | readonly [string, string, string, string, "events", number, number];

const touchesOwn = (e: KascovTokenEvent, own: ReadonlySet<string>) =>
  own.has(e.ownerTo) || (e.ownerFrom !== undefined && own.has(e.ownerFrom));

async function eventsPage(
  tokenId: string,
  own: ReadonlySet<string>,
  eventsPage: number,
  beforeSeq?: number,
): Promise<HistoryPage> {
  const page = await fetchTokenEvents(tokenId, beforeSeq);
  return {
    source: "events",
    events: page.events.filter((e) => touchesOwn(e, own)),
    eventsPage,
    ...(page.nextBeforeSeq !== undefined && {
      nextBeforeSeq: page.nextBeforeSeq,
    }),
  };
}

// Rows kascov could not attribute are filled from the token's event log (one read per page, only if needed).
const transfersPage = async (
  owner: string,
  tokenId: string,
  page: Awaited<ReturnType<typeof fetchOwnerTransfers>>,
): Promise<HistoryPage> => ({
  source: "transfers",
  owner,
  rows: [...(await attributeFromEventLog(page.transfers, tokenId))],
  ...(page.next && { next: page.next }),
});

async function firstPage(
  address: string,
  tokenId: string,
  [bare, presence]: string[],
  own: ReadonlySet<string>,
): Promise<HistoryPage> {
  const [{ holdings, tip }, bareRows] = await Promise.all([
    fetchStandardHoldingsWithTip(address),
    fetchOwnerTransfers(bare, tokenId),
  ]);
  if (bareRows.transfers.length > 0)
    return { ...(await transfersPage(bare, tokenId, bareRows)), tip };
  // Layouts index one form or the other; `presence:` tokens never answer to bare.
  const presenceRows = await fetchOwnerTransfers(presence, tokenId);
  const held = holdings.some((h) => h.tokenId === tokenId && h.balance > 0n);
  // Nothing under either form for a token kascov says is held: read the log instead.
  if (presenceRows.transfers.length === 0 && held)
    return { ...(await eventsPage(tokenId, own, 1)), tip };
  return { ...(await transfersPage(presence, tokenId, presenceRows)), tip };
}

// Families kascov indexes by the wallet's owner strings. A legacy piece the wallet can spend
// decodes to identifier ADDRESS or PUBKEY over the same x-only key (isOwnedBy), and kascov
// lists it as `presence:<pk>` or bare `<pk>`: the two strings firstPage already asks.
const HISTORY_FAMILIES: ReadonlySet<string> = new Set<Kcc20Family>([
  "kcc20-standard",
  "kron-legacy",
]);

/** Why a token has no history; the component words each one. */
export type Kcc20HistoryUnavailable =
  // kascov indexes mainnet only, so nothing else is ever sent to it.
  | "network"
  // The kcc20 standard flag is kascov's kill switch: off, it is never asked.
  | "disabled"
  // Not a Schnorr P2PK wallet: no x-only key for kascov to know it by.
  | "wallet"
  | "family";

/** Why history stops before the wallet's oldest transfer; the component words each one. */
export type Kcc20HistoryTruncated =
  // The events fallback spent EVENTS_FALLBACK_PAGE_CAP pages and the log goes on.
  "events-cap";

/**
 * KCC-20 history of `token` for `address`, newest first, paged on demand.
 * Mainnet, standard and kron-legacy only; anything else is `unavailable` with a reason,
 * never an empty list.
 */
export function useKcc20History(
  address?: string,
  token?: Pick<Kcc20Token, "covenantId" | "family">,
) {
  // One source for the network: the RPC client the rest of the page reads.
  const { networkId } = useRpcClientStateful();
  const { isKcc20StandardEnabled } = useFeatureFlags();
  const covenantId = token?.covenantId;

  const owners = useMemo(() => {
    const key = address ? standardOwnerKey(address) : undefined;
    return key ? ownerStrings(key) : undefined;
  }, [address]);
  const own = useMemo(() => new Set(owners), [owners]);

  const unavailableReason: Kcc20HistoryUnavailable | undefined =
    // The RPC client names its network only once settings load: wait, never flash "network".
    !address || !token || !networkId
      ? undefined
      : networkId !== NetworkType.Mainnet
        ? "network"
        : !isKcc20StandardEnabled
          ? "disabled"
          : !HISTORY_FAMILIES.has(token.family)
            ? "family"
            : !owners
              ? "wallet"
              : undefined;
  const enabled =
    !!address && !!networkId && !!covenantId && !unavailableReason;

  const getKey = (
    pageIndex: number,
    prev: HistoryPage | null,
  ): HistoryKey | null => {
    if (!enabled) return null;
    const base = ["kcc20History", networkId, address, covenantId] as const;
    if (pageIndex === 0) return [...base, "first"];
    if (!prev) return null;
    if (prev.source === "transfers")
      return prev.next ? [...base, "transfers", prev.owner, prev.next] : null;
    return prev.nextBeforeSeq !== undefined &&
      prev.eventsPage < EVENTS_FALLBACK_PAGE_CAP
      ? [...base, "events", prev.nextBeforeSeq, prev.eventsPage + 1]
      : null;
  };

  const fetchPage = async (key: HistoryKey): Promise<HistoryPage> => {
    const tokenId = key[3];
    if (key[4] === "first") return firstPage(key[2], tokenId, owners!, own);
    if (key[4] === "transfers") {
      const [, , , , , owner, cursor] = key;
      return transfersPage(
        owner,
        tokenId,
        await fetchOwnerTransfers(owner, tokenId, cursor),
      );
    }
    const [, , , , , beforeSeq, n] = key;
    return eventsPage(tokenId, own, n, beforeSeq);
  };

  const { data, error, size, setSize, isLoading, mutate } = useSWRInfinite<
    HistoryPage,
    Error,
    typeof getKey
  >(getKey, fetchPage, { revalidateFirstPage: false });

  const entries = useMemo(() => {
    // Every page dates itself from page 1's tip, so one list shares one clock.
    const tip = data?.[0]?.tip;
    if (!data || !tip) return [];
    // Page 1 picks the source; every later page follows it.
    if (data[0].source === "transfers")
      // toHistoryEntries keeps the first row per txid:seq, so a page repeating
      // its predecessor's edge adds nothing.
      return toHistoryEntries(
        data.flatMap((p) => (p.source === "transfers" ? p.rows : [])),
        own,
        [],
        tip,
      );
    // A split's deltas name the wallet's side; a merge's row stays unattributed.
    return eventEntries(
      data.flatMap((p) => (p.source === "events" ? p.events : [])),
      own,
      tip,
    );
  }, [data, own]);

  const last = data?.[data.length - 1];
  const truncatedReason: Kcc20HistoryTruncated | undefined =
    last?.source === "events" &&
    last.nextBeforeSeq !== undefined &&
    last.eventsPage >= EVENTS_FALLBACK_PAGE_CAP
      ? "events-cap"
      : undefined;
  const hasMore =
    !!last &&
    (last.source === "transfers"
      ? last.next !== undefined
      : last.nextBeforeSeq !== undefined && !truncatedReason);
  // A page past page 1 was asked for and has not landed yet.
  const isLoadingMore =
    !!data && size > data.length && data.length > 0 && !error;

  return {
    entries,
    size,
    setSize,
    hasMore,
    isLoading: enabled && isLoading,
    isLoadingMore: enabled && isLoadingMore,
    error,
    retry: () => mutate(),
    unavailable: unavailableReason !== undefined,
    unavailableReason,
    truncated: truncatedReason !== undefined,
    truncatedReason,
  };
}
