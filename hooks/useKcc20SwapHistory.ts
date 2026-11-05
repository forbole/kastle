import { useMemo } from "react";
import useSWR from "swr";
import { NetworkType } from "@/contexts/SettingsContext";
import { useSettings } from "@/hooks/useSettings";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { ownerStrings, standardOwnerKey } from "@/lib/kcc20/history";
import {
  applyKcc20SwapMoney,
  buildKcc20SwapRecords,
  fetchKcc20SwapMoney,
  fetchKcc20SwapTransfers,
  kcc20SwapMoneyTxids,
  kcc20SwapTokenMeta,
} from "@/lib/activity/kcc20-swap-history";
import type { Kcc20SwapFamily } from "@/lib/activity/swap-history";

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
  const owners = useMemo(() => {
    const key = kaspaAddress ? standardOwnerKey(kaspaAddress) : undefined;
    return key ? ownerStrings(key) : undefined;
  }, [kaspaAddress]);
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

  const built = useMemo((): Kcc20SwapFamily | null => {
    // Until the token list settles a row may not be nameable yet; that is
    // loading, not an unidentified token.
    if (!data || !owners || tokens.isLoading) return null;
    if (!data.tip)
      return {
        swaps: [],
        health: data.health,
        unidentified: 0,
        unattributed: 0,
      };
    return {
      ...buildKcc20SwapRecords({
        rows: data.rows,
        own: new Set(owners),
        tip: data.tip,
        tokens: kcc20SwapTokenMeta(tokens.data ?? [], data.holdings),
      }),
      health: data.health,
    };
  }, [data, owners, tokens.data, tokens.isLoading]);

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
  );

  const family = useMemo(
    () =>
      built && money
        ? { ...built, swaps: applyKcc20SwapMoney(built.swaps, money) }
        : built,
    [built, money],
  );

  return {
    family: on ? family : null,
    // A timed-out money read is not cached, so re-reading retries it even
    // when the rows (and so the money key) are unchanged.
    refresh: () => Promise.all([mutate(), mutateMoney()]),
  };
}
