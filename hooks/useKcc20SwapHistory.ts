import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { bytesToHex } from "@noble/hashes/utils";
import { NetworkType } from "@/contexts/SettingsContext";
import { useSettings } from "@/hooks/useSettings";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { ownerStrings, standardOwnerKey } from "@/lib/kcc20/history";
import {
  applyBraidTxids,
  applyKcc20SwapMoney,
  braidCandidateTxids,
  braidPendingRecords,
  buildKcc20SwapRecords,
  fetchBraidSellSettles,
  fetchBraidTxids,
  fetchKcc20SwapMoney,
  fetchKcc20SwapTransfers,
  kcc20SwapMoneyTxids,
  kcc20SwapTokenMeta,
  resetBraidSettleRetries,
} from "@/lib/activity/kcc20-swap-history";
import type { Kcc20SwapFamily } from "@/lib/activity/swap-history";
import { fetchKronMarkets } from "@/lib/kcc20/swap";
import type { SwapActivityRecord } from "@/lib/activity/mappers";
import { sameSpots } from "@/lib/activity/adapters";
import {
  type PendingBraidSwap,
  getPendingBraidSwaps,
  subscribeBraidSwaps,
} from "@/lib/braid/pending";

/**
 * KCC-20 swaps of the wallet's Kaspa address, for useActivityFeed to merge
 * into the swap rows (mergeKcc20SwapHistory). Its own SWR entry, not a fifth
 * source inside the feed's fetcher: kascov failing or loading must not hold
 * back or re-key the EVM and bridge rows. Null while disabled or loading.
 *
 * Mainnet only (kascov indexes nothing else), and never asked while the
 * kcc20 standard flag — kascov's kill switch — is off. Read-only.
 */
export function useKcc20SwapHistory(
  kaspaAddress: string | undefined,
  enabled: boolean,
): { family: Kcc20SwapFamily | null; refresh: () => Promise<unknown> } {
  const [settings] = useSettings();
  const { isKcc20StandardEnabled } = useFeatureFlags();
  const ownerKey = useMemo(
    () => (kaspaAddress ? standardOwnerKey(kaspaAddress) : undefined),
    [kaspaAddress],
  );
  const owners = useMemo(
    () => (ownerKey ? ownerStrings(ownerKey) : undefined),
    [ownerKey],
  );
  const on =
    enabled &&
    !!kaspaAddress &&
    !!owners &&
    settings?.networkId === NetworkType.Mainnet &&
    isKcc20StandardEnabled;

  // Names legacy tokens from the registry; shares its SWR entry with the token list.
  const tokens = useKcc20Tokens(on ? kaspaAddress : undefined);
  const { data, mutate } = useSWR(
    on ? ["kcc20-swap-history", kaspaAddress] : null,
    // /transfers answers 400 to `p2pkh:`, so only bare and `presence:` are asked.
    () => fetchKcc20SwapTransfers(kaspaAddress!, owners!.slice(0, 2)),
    { refreshInterval: 30_000, dedupingInterval: 5_000 },
  );

  // KRON's registry names a token the wallet sold out of. Same key as the
  // screen's price maps and useKcc20Price: one download, shared. Never waited
  // on: the rows paint, then a late registry names what it can.
  const { data: kron } = useSWR(on ? "kronMarkets" : null, fetchKronMarkets);
  const tokenMeta = useMemo(
    () =>
      kcc20SwapTokenMeta(tokens.data ?? [], data?.holdings ?? [], [
        ...(kron ?? []),
        ...(kron?.graduated ?? []),
      ]),
    [tokens.data, data?.holdings, kron],
  );

  // Braid deposits this wallet sent that have not settled: kascov lists a
  // trade only once it is accepted, so these rows come from local storage.
  const [braidSwaps, setBraidSwaps] = useState<PendingBraidSwap[]>([]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const load = () =>
      void getPendingBraidSwaps().then(
        (swaps) => alive && setBraidSwaps(swaps),
        () => {},
      );
    load();
    const off = subscribeBraidSwaps(load);
    return () => {
      alive = false;
      off();
    };
  }, [on]);

  const built = useMemo(():
    | (Kcc20SwapFamily & { braidSells: SwapActivityRecord[] })
    | null => {
    // Until the token list settles a row may not be nameable yet; that is
    // loading, not an unknown token.
    if (!data || !owners || tokens.isLoading) return null;
    if (!data.tip)
      return {
        swaps: [],
        braidSells: [],
        health: data.health,
        unattributed: 0,
      };
    return {
      ...buildKcc20SwapRecords({
        rows: data.rows,
        own: new Set(owners),
        tip: data.tip,
        tokens: tokenMeta,
      }),
      health: data.health,
    };
  }, [data, owners, tokens.isLoading, tokenMeta]);

  // The KAS side, one L1 transaction read per row, in its own SWR entry so
  // the rows paint first and the amounts land after. Keyed on the txids it
  // reads: a new trade re-keys it, a refresh with the same rows does not.
  const moneyTxids = useMemo(
    () => (built ? kcc20SwapMoneyTxids(built.swaps) : []),
    [built],
  );
  const { data: money, mutate: mutateMoney } = useSWR(
    on && moneyTxids.length
      ? ["kcc20-swap-money", kaspaAddress, ...moneyTxids]
      : null,
    () => fetchKcc20SwapMoney(kaspaAddress!, built!.swaps),
    // A retried read lands only if SWR can tell the Maps apart.
    { compare: sameSpots },
  );

  // Which trades went through Braid: a pending record is gone once a trade
  // settles, so the deposit's own payload says it. Same per-txid read shape.
  const braidTxids = useMemo(
    () => (built ? braidCandidateTxids(built.swaps, built.braidSells) : []),
    [built],
  );
  const { data: braid, mutate: mutateBraid } = useSWR(
    on && braidTxids.length
      ? ["kcc20-swap-braid", kaspaAddress, ...braidTxids]
      : null,
    () => fetchBraidTxids(kaspaAddress!, braidTxids),
  );

  // How each Braid sell settled: one listing of its router coin's address.
  // Its own entry, so the rows paint before it lands. An open sell is
  // re-read until its settle is accepted; final outcomes are cached.
  const settleTxids = useMemo(
    () => [...(braid?.deposits.keys() ?? [])],
    [braid],
  );
  const { data: settles, mutate: mutateSettles } = useSWR(
    on && settleTxids.length
      ? ["kcc20-swap-braid-settle", kaspaAddress, ...settleTxids]
      : null,
    () => fetchBraidSellSettles(kaspaAddress!, braid!.deposits),
    {
      // Re-read while a sell is open or its listing could not be read: a
      // failed read is not "no settle", and nothing else would ask again.
      // An unread sell is listed on a capped backoff inside the fetcher
      // (BRAID_SETTLE_TRIES); given up, it stops counting, so this stops.
      refreshInterval: (d) =>
        d &&
        (d.unread > 0 ||
          [...d.settles.values()].some((v) => v.state === "open"))
          ? 30_000
          : 0,
      // Without it a re-read that finds the settle is discarded as "equal".
      compare: (a, b) =>
        a?.unread === b?.unread && sameSpots(a?.settles, b?.settles),
    },
  );

  const family = useMemo((): Kcc20SwapFamily | null => {
    if (!built) return built;
    const { braidSells, ...rest } = built;
    const priced = money ? applyKcc20SwapMoney(rest.swaps, money) : rest.swaps;
    const pending =
      ownerKey && braidSwaps.length
        ? braidPendingRecords(braidSwaps, bytesToHex(ownerKey), tokenMeta)
        : [];
    const swaps = applyBraidTxids(
      priced,
      braidSells,
      braid?.braid ?? new Set(),
      pending,
      braid?.deposits,
      settles?.settles,
    );
    // An unread candidate may be a Braid sell this list cannot show yet.
    return {
      ...rest,
      swaps,
      braidUnread: braid?.unread ?? 0,
    };
  }, [built, money, braid, settles, ownerKey, braidSwaps, tokenMeta]);

  return {
    family: on ? family : null,
    // A timed-out money read is not cached, so re-reading retries it even
    // when the rows (and so the money key) are unchanged.
    // A fresh load asks given-up Braid sells again, on the same schedule.
    refresh: () => {
      resetBraidSettleRetries();
      return Promise.all([
        mutate(),
        mutateMoney(),
        mutateBraid(),
        mutateSettles(),
      ]);
    },
  };
}
