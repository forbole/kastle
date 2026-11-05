import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { useIntersectionObserver } from "usehooks-ts";
import { formatUnits } from "viem";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { explorerTxLinks } from "@/components/screens/Settings";
import { NetworkType } from "@/contexts/SettingsContext";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import type { Kcc20Token } from "@/lib/kcc20";
import { Kcc20HistoryRow, toHistoryRow } from "@/lib/kcc20/history";
import {
  Kcc20HistoryUnavailable,
  useKcc20History,
} from "@/lib/kcc20/useKcc20History";
import { textEllipsis } from "@/lib/utils";
import ActionSheet from "@/ui/general/ActionSheet";

const UNAVAILABLE: Record<Kcc20HistoryUnavailable, string> = {
  network: "History is shown on mainnet only.",
  disabled: "History is not enabled on this device yet.",
  wallet: "History needs a standard Kaspa (Schnorr) address.",
  family: "History is not supported for this token type.",
};

const KIND_LABEL: Record<Kcc20HistoryRow["kind"], string> = {
  receive: "Receive",
  send: "Send",
  self: "Self transfer",
  buy: "Buy",
  sell: "Sell",
  unknown: "Token activity",
};

// kascov dates rows from its DAA clock, so every time carries "≈" and this note.
const APPROX_TIME_NOTE = "Approximate time, counted from the DAA score";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const approxTime = (ms: number) => `≈ ${timeFormat.format(new Date(ms))}`;

type TokenView = { symbol: string; decimals?: number; logo?: string };

// Signed for the row; absent when kascov could not attribute it or decimals are unknown.
function amountLabel(row: Kcc20HistoryRow, token: TokenView) {
  if (row.amount === undefined || token.decimals === undefined) return;
  const value = formatUnits(row.amount, token.decimals);
  const sign =
    row.direction === "in" ? "+" : row.direction === "out" ? "-" : "";
  return `${sign}${value} ${token.symbol}`;
}

function Spinner() {
  return (
    <div
      className="inline-block size-6 animate-spin self-center rounded-full border-[3px] border-current border-t-icy-blue-400 text-icy-blue-600"
      role="status"
      aria-label="loading"
    />
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-daintree-700 bg-daintree-800 p-4 text-center text-sm text-daintree-400">
      {children}
    </div>
  );
}

function Kcc20HistoryItem({
  row,
  token,
  onClick,
}: {
  row: Kcc20HistoryRow;
  token: TokenView;
  onClick: () => void;
}) {
  const [imageUrl, setImageUrl] = useState(token.logo ?? kasIcon);
  const amount = amountLabel(row, token);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[72px] shrink-0 items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white"
    >
      <img
        alt={token.symbol}
        className="h-[40px] w-[40px] shrink-0 rounded-full"
        src={imageUrl}
        onError={() => setImageUrl(kasIcon)}
      />
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-base text-white">
          <span className="truncate">{KIND_LABEL[row.kind]}</span>
          {amount && (
            <span
              className={twMerge(
                "truncate",
                row.direction === "out"
                  ? "text-red-500"
                  : row.direction === "in"
                    ? "text-teal-500"
                    : "text-white",
              )}
            >
              {amount}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-daintree-400">
          <span className="truncate">
            {row.counterparty?.label ?? textEllipsis(row.txid)}
          </span>
          <span className="shrink-0" title={APPROX_TIME_NOTE}>
            {approxTime(row.timeMs)}
          </span>
        </div>
      </div>
    </button>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-daintree-700 py-3 text-sm last:border-b-0">
      <span className="shrink-0 text-daintree-400">{label}</span>
      <div className="min-w-0 break-all text-right text-white">{children}</div>
    </div>
  );
}

function Kcc20HistoryDetail({
  row,
  token,
}: {
  row: Kcc20HistoryRow;
  token: TokenView;
}) {
  const { networkId } = useRpcClientStateful();
  const explorer = explorerTxLinks[networkId ?? NetworkType.Mainnet];

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h3 className="text-center text-lg font-semibold text-white">
        {KIND_LABEL[row.kind]}
      </h3>
      <div className="flex flex-col">
        <DetailRow label="Amount">
          {amountLabel(row, token) ?? "Unavailable"}
        </DetailRow>
        <DetailRow label={row.direction === "in" ? "From" : "To"}>
          {row.counterparty ? (
            <div className="flex flex-col items-end">
              <span>{row.counterparty.label}</span>
              <span className="text-xs text-daintree-400">
                {row.counterparty.address}
              </span>
            </div>
          ) : (
            "Unavailable"
          )}
        </DetailRow>
        <DetailRow label="Transaction ID">{row.txid}</DetailRow>
        <DetailRow label="Time">
          <div className="flex flex-col items-end">
            <span>{approxTime(row.timeMs)}</span>
            <span className="text-xs text-daintree-400">
              {APPROX_TIME_NOTE}
            </span>
          </div>
        </DetailRow>
        {/* kascov never says a transition is final, so the status is not claimed. */}
        <DetailRow label="Status">Unknown</DetailRow>
      </div>
      {explorer && (
        <button
          type="button"
          onClick={() => browser.tabs.create({ url: `${explorer}${row.txid}` })}
          className="flex items-center justify-center gap-2 rounded-xl border border-daintree-700 bg-white/5 px-4 py-3 text-base font-medium text-white hover:border-white"
        >
          View in explorer
          <ExternalLink aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * KCC-20 history of `token` for `address` from kascov, paged as the sentinel scrolls in.
 * Renders inside the page's scroll body: no height of its own.
 */
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
  } = useKcc20History(address, token);
  const [selected, setSelected] = useState<Kcc20HistoryRow>();

  const { ref: trigger } = useIntersectionObserver({
    threshold: 0.5,
    onChange: (isIntersecting) => {
      if (isIntersecting && hasMore && !isLoadingMore && !error)
        setSize((prev) => prev + 1);
    },
  });

  const view: TokenView = {
    symbol: token?.meta?.symbol ?? textEllipsis(token?.covenantId ?? ""),
    decimals: token?.meta?.decimals,
    logo: token?.meta?.logoURI,
  };
  const rows = entries.map(toHistoryRow);

  if (unavailableReason)
    return <Notice>{UNAVAILABLE[unavailableReason]}</Notice>;

  // Page 1 failed: nothing to show but the way back.
  if (error && rows.length === 0)
    return (
      <Notice>
        <div className="flex flex-col items-center gap-3">
          <span>Could not load history.</span>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full border border-daintree-700 px-4 py-1.5 text-white hover:border-white"
          >
            Retry
          </button>
        </div>
      </Notice>
    );

  if (isLoading || !token) return <Spinner />;

  if (rows.length === 0) return <Notice>No history yet.</Notice>;

  return (
    <div className="flex flex-col items-stretch gap-2">
      {rows.map((row) => (
        <Kcc20HistoryItem
          key={row.id}
          row={row}
          token={view}
          onClick={() => setSelected(row)}
        />
      ))}
      {error ? (
        <button
          type="button"
          onClick={() => retry()}
          className="self-center rounded-full border border-daintree-700 px-4 py-1.5 text-sm text-white hover:border-white"
        >
          Retry
        </button>
      ) : (
        isLoadingMore && <Spinner />
      )}
      {/* A zero-height sentinel sits a subpixel past the scroll body's edge and never fires. */}
      <div ref={trigger} className="h-1 shrink-0" />
      <ActionSheet isOpen={!!selected} onClose={() => setSelected(undefined)}>
        {selected && <Kcc20HistoryDetail row={selected} token={view} />}
      </ActionSheet>
    </div>
  );
}
