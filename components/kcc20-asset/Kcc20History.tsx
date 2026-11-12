import { kcc20TxLinks } from "@/components/screens/Settings";
import { NetworkType } from "@/contexts/SettingsContext";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { toHistoryRecord } from "@/lib/history/from-kcc20";
import type { Kcc20Token } from "@/lib/kcc20";
import { toHistoryRow } from "@/lib/kcc20/history";
import {
  Kcc20HistoryTruncated,
  Kcc20HistoryUnavailable,
  useKcc20History,
} from "@/lib/kcc20/useKcc20History";
import { textEllipsis } from "@/lib/utils";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import { CHAIN_BADGES } from "@/ui/popup/kcc20/AssetImage";

const UNAVAILABLE: Record<Kcc20HistoryUnavailable, string> = {
  network: "History is shown on mainnet only.",
  disabled: "History is not enabled on this device yet.",
  wallet: "History needs a standard Kaspa (Schnorr) address.",
  family: "History is not supported for this token type.",
};

const TRUNCATED: Record<Kcc20HistoryTruncated, string> = {
  "events-cap": "Older history is not shown.",
};

/** KCC-20 history of `token` for `address` from kascov, through the shared shell. */
export function Kcc20History({
  address,
  token,
}: {
  address?: string;
  token?: Kcc20Token;
}) {
  const {
    entries,
    setSize,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    retry,
    unavailableReason,
    truncatedReason,
  } = useKcc20History(address, token);
  const { networkId } = useRpcClientStateful();
  // kascov only, and only where it has a route: no link beats the wrong explorer.
  const explorerBase = kcc20TxLinks[networkId ?? NetworkType.Mainnet];

  const view = {
    symbol:
      (token?.meta?.symbol ?? token?.tick) ||
      textEllipsis(token?.covenantId ?? ""),
    decimals: token?.meta?.decimals,
  };
  const records = entries.map((e) =>
    toHistoryRecord(toHistoryRow(e), view, explorerBase),
  );
  // Same logo and corner mark the token page header shows; one tx per row.
  const rowExtras = {
    logo: token?.meta?.logoURI,
    chainBadge: CHAIN_BADGES.kcc20,
    txCount: 1,
    isSymbolHidden: true,
  };
  const truncated = truncatedReason ? TRUNCATED[truncatedReason] : undefined;

  return (
    <HistoryList
      key={`${address}:${token?.covenantId ?? token?.tick}`}
      records={records}
      // No token yet reads as loading, as before.
      isLoading={isLoading || !token}
      isLoadingMore={isLoadingMore}
      error={error ?? null}
      hasMore={hasMore}
      onRetry={() => retry()}
      onLoadMore={() => setSize((prev) => prev + 1)}
      unavailableMessage={
        unavailableReason ? UNAVAILABLE[unavailableReason] : undefined
      }
      // An empty-but-truncated list says so instead of "No history yet."
      emptyMessage={truncated ?? "No history yet."}
      truncatedMessage={records.length > 0 ? truncated : undefined}
      getRowExtras={() => rowExtras}
    />
  );
}
