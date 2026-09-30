import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import GeneralHeader from "@/components/GeneralHeader";
import BottomNav from "@/components/BottomNav";
import { BottomSheet, Skeleton } from "@/components/swap-bridge/ui";
import kaspaIcon from "@/assets/images/network-logos/kaspa.svg";
import { NetworkType } from "@/contexts/SettingsContext";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import {
  useZealousSwapIgraTokensMetadata,
  useZealousSwapTokensMetadata,
  ZEALOUS_SWAP_IGRA_IMAGE_URL,
  ZEALOUS_SWAP_IMAGE_URL,
} from "@/hooks/evm/provider/useZealousSwap";
import {
  ActivityItem,
  PillStatus,
  toActivityItem,
} from "@/lib/activity/adapters";
import { rowsForPage, type ActivityPageType } from "@/lib/activity/mappers";
import type { BridgeHistoryDegradation } from "@/lib/bridge/kat-bridge-history";
import type { IgraDepositDegradation } from "@/lib/bridge/igra-deposit-history";
import type { KurveRegistryDegradation } from "@/lib/bridge/kat-registry";
import type { SwapHistoryDegradation } from "@/lib/activity/swap-history";

// Ported from kastle-mobile app/(has-wallet)/activity.tsx + ActivityContainer +
// kastle-ui's ActivityScreen/ActivityRow/ActivityDetailSheet. No extension
// Figma: layout follows mobile, styling follows the swap/bridge screens.

// A partial list must never read as a complete one — each page names the
// upstream that failed. Mobile's "Pull to retry" becomes the refresh button.
const BRIDGE_SOURCE_MESSAGE: Record<
  BridgeHistoryDegradation | IgraDepositDegradation | KurveRegistryDegradation,
  string
> = {
  bridge_history_deposits_unavailable:
    "Couldn't load bridge deposits — some incoming transfers may be missing. Refresh to retry.",
  bridge_history_exits_unavailable:
    "Couldn't load bridge withdrawals — some outgoing transfers may be missing. Refresh to retry.",
  bridge_history_unavailable:
    "Couldn't reach the KAT bridge — this list may be incomplete. Refresh to retry.",
  igra_deposits_unavailable:
    "Couldn't load Kaspa → Igra deposits — some incoming transfers may be missing. Refresh to retry.",
  igra_deposits_partial:
    "Only recent Kaspa → Igra deposits are shown — this wallet's history is too long to read in full.",
  bridge_history_deposits_partial:
    "This wallet has more bridge deposits than shown — some older transfers may be missing.",
  bridge_history_exits_partial:
    "This wallet has more bridge withdrawals than shown — some older transfers may be missing.",
  bridge_history_partial:
    "This wallet has more bridge transfers than shown — some older transfers may be missing.",
  kurve_registry_partial:
    "This wallet has more Kasplex bridge transfers than shown — some older transfers may be missing.",
};

const SWAP_SOURCE_MESSAGE: Record<SwapHistoryDegradation, string> = {
  swap_history_unavailable:
    "Couldn't load swap history — some swaps may be missing. Refresh to retry.",
  swap_history_igra_unavailable:
    "Couldn't load Igra swap history — Igra swaps may be missing. Kasplex swaps are shown. Refresh to retry.",
  swap_history_kasplex_unavailable:
    "Couldn't load Kasplex swap history — Kasplex swaps may be missing. Igra swaps are shown. Refresh to retry.",
  swap_history_partial:
    "Only recent swaps are shown — this wallet's history is too long to read in full.",
  swap_history_legs_unresolved:
    "Some swap amounts couldn't be confirmed — parts of these transactions couldn't be read.",
};

const EMPTY_COPY: Record<ActivityPageType, [string, string]> = {
  swap: ["No activity yet", "Your swaps will appear here once you make one."],
  bridge: ["No bridges yet", "Your bridge transactions will appear here."],
};

const PILL_CLASS: Record<PillStatus, string> = {
  success: "bg-teal-500/15 text-teal-400",
  failed: "bg-red-500/15 text-red-400",
  pending: "bg-amber-500/15 text-amber-400",
};

const openUrl = (url: string) => browser.tabs.create({ url });

const toList = <T,>(value: T | T[] | null): T[] =>
  !value ? [] : Array.isArray(value) ? value : [value];

/** Symbol → logo/price, as mobile's useTokenLogoMap / useTokenPriceMap. */
function useTokenMaps() {
  const { kaspaPrice } = useKaspaPrice();
  const { data: kasplex } = useZealousSwapTokensMetadata();
  const { data: igra } = useZealousSwapIgraTokensMetadata();
  return useMemo(() => {
    const logos = new Map<string, string>();
    const prices = new Map<string, number>();
    // Igra last, so it wins a symbol collision (mobile parity).
    for (const [list, base] of [
      [kasplex?.tokens, ZEALOUS_SWAP_IMAGE_URL],
      [igra?.tokens, ZEALOUS_SWAP_IGRA_IMAGE_URL],
    ] as const) {
      for (const t of list ?? []) {
        const key = t.symbol.toUpperCase();
        if (t.logoURI) logos.set(key, `${base}${t.logoURI}`);
        if (t.price > 0) prices.set(key, t.price);
      }
    }
    for (const kas of ["KAS", "IKAS"]) {
      logos.set(kas, kaspaIcon);
      if (kaspaPrice > 0) prices.set(kas, kaspaPrice);
    }
    return {
      logoFor: (symbol: string) => logos.get(symbol.toUpperCase()),
      priceFor: (symbol: string) => prices.get(symbol.toUpperCase()),
    };
  }, [kasplex, igra, kaspaPrice]);
}

function TokenIcon({ src, className }: { src?: string; className: string }) {
  // Same fallback as Layer2AssetImage / AmountInput: the Kaspa logo.
  return (
    <img
      src={src ?? kaspaIcon}
      alt=""
      onError={(e) => (e.currentTarget.src = kaspaIcon)}
      className={twMerge("rounded-full object-cover", className)}
    />
  );
}

function PairImage({ item }: { item: ActivityItem }) {
  // Figma "logo frame": 40px, tokens 24px + 26px, 12px chain badge.
  return (
    <div className="relative size-10 shrink-0">
      <TokenIcon
        src={item.fromImage}
        className="absolute left-0 top-0 size-6"
      />
      <TokenIcon
        src={item.toImage}
        className="absolute bottom-[3px] right-0 size-[26px] border-2 border-icy-blue-900"
      />
      <img
        src={item.chainImage}
        alt=""
        className="absolute -bottom-px left-8 size-3 rounded-full border border-icy-blue-900 bg-black"
      />
    </div>
  );
}

function ActivityRow({
  item,
  onClick,
}: {
  item: ActivityItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-16 w-full items-center gap-3 rounded-2xl border border-daintree-750 bg-white/5 px-3 text-left hover:border-daintree-400"
    >
      <PairImage item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-base font-semibold text-white">{item.title}</span>
        <span className="text-xs text-daintree-300">{item.dateTime}</span>
      </div>
      <div className="flex min-w-0 flex-col items-end gap-1.5">
        <span
          className={twMerge(
            "max-w-40 truncate text-base font-semibold",
            item.tone === "credit" ? "text-teal-400" : "text-white",
          )}
        >
          {item.amountNumber}
          {item.amountSymbol && ` ${item.amountSymbol}`}
        </span>
        {item.amountUsd && (
          <span className="text-xs text-daintree-300">{item.amountUsd}</span>
        )}
      </div>
    </button>
  );
}

function TransferLeg({
  label,
  amount,
  usd,
  symbol,
  image,
  chainImage,
}: {
  label: string;
  amount: string;
  usd?: string;
  symbol: string;
  image?: string;
  chainImage: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-daintree-400">{label}</span>
        <span className="truncate text-base font-semibold text-white">
          {amount}
        </span>
        {usd && <span className="text-xs text-daintree-400">{usd}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm text-white">
        <div className="relative h-7 w-7">
          <TokenIcon src={image} className="h-7 w-7" />
          <img
            src={chainImage}
            alt=""
            className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full"
          />
        </div>
        {symbol}
      </div>
    </div>
  );
}

function ActivityDetail({ item }: { item: ActivityItem }) {
  const t = item.sheet.transfer;
  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-daintree-700 p-3">
        <TransferLeg
          label={t.sentLabel}
          amount={t.sentAmount}
          usd={t.sentUsd}
          symbol={t.fromSymbol}
          image={t.fromImage}
          chainImage={t.fromChainImage}
        />
        {t.receivedAmount !== undefined && (
          <TransferLeg
            label={t.receivedLabel}
            amount={t.receivedAmount}
            usd={t.receivedUsd}
            symbol={t.toSymbol}
            image={t.toImage}
            chainImage={t.toChainImage}
          />
        )}
      </div>
      {/* Figma 14040:354930: rows are py-12 with 21px text, no gap between. */}
      <div className="flex flex-col px-2">
        {item.sheet.details.map((d) => (
          <div
            key={d.label}
            className="flex items-center justify-between gap-3 py-3 text-sm leading-[21px]"
          >
            <span className="text-daintree-200">{d.label}</span>
            {d.pill ? (
              <span
                className={twMerge(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  PILL_CLASS[d.pill],
                )}
              >
                {d.value}
              </span>
            ) : d.url ? (
              <button
                type="button"
                onClick={() => openUrl(d.url!)}
                className="flex items-center gap-2 text-icy-blue-400"
              >
                <i className="hn hn-external-link text-lg" />
                {d.value}
              </button>
            ) : (
              <span className="flex items-center gap-2 text-right text-white">
                {d.icon && (
                  <img src={d.icon} alt="" className="size-7 rounded-full" />
                )}
                {d.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default function Activity() {
  const [params] = useSearchParams();
  const pageType: ActivityPageType =
    params.get("type") === "bridge" ? "bridge" : "swap";
  const { networkId } = useRpcClientStateful();
  const isMainnet = (networkId ?? NetworkType.Mainnet) === NetworkType.Mainnet;
  const feed = useActivityFeed(isMainnet);
  const { logoFor, priceFor } = useTokenMaps();
  const [openId, setOpenId] = useState<string>();

  const rows = feed.rows ? rowsForPage(feed.rows, pageType) : null;
  // In-flight bridges pin to the top; the stable sort keeps newest-first below.
  const items = rows
    ?.map((row) => toActivityItem(row, { logoFor, priceFor }))
    .sort((a, b) => Number(b.isInProgress) - Number(a.isInProgress));
  const open = items?.find((i) => i.id === openId);

  const warnings = (
    pageType === "bridge"
      ? [feed.bridgeSource, feed.depositSource, feed.kurveSource].map((t) =>
          t ? BRIDGE_SOURCE_MESSAGE[t] : undefined,
        )
      : toList(feed.swapSource).map((t) => SWAP_SOURCE_MESSAGE[t])
  ).filter((m): m is string => !!m);

  const [emptyTitle, emptyBody] = EMPTY_COPY[pageType];

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0 px-4 pt-4">
        <GeneralHeader
          title={pageType === "bridge" ? "Bridge Activity" : "Swap Activity"}
          showClose={false}
          lucideBack
          titleClassName="text-gray-200"
        />
        {isMainnet && (
          <button
            type="button"
            onClick={feed.refresh}
            disabled={feed.isRefreshing}
            aria-label="Refresh"
            title="Refresh"
            // Sits over GeneralHeader's empty right slot, like ActivityHeaderButton.
            className="absolute right-4 top-4 rounded-lg p-3 text-white hover:bg-daintree-800 disabled:opacity-50"
          >
            <i
              className={twMerge(
                "hn hn-refresh flex text-xl",
                feed.isRefreshing && "animate-spin",
              )}
            />
          </button>
        )}
      </div>
      <div className="no-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-2">
        {!isMainnet ? (
          <p className="py-10 text-center text-sm text-daintree-400">
            Activity is available on Mainnet only.
          </p>
        ) : (
          <>
            {warnings.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                {warnings.map((m) => (
                  <p key={m} className="text-xs text-amber-300">
                    {m}
                  </p>
                ))}
              </div>
            )}

            {items === undefined ? (
              feed.error ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm text-daintree-400">
                    {"Couldn't load activity."}
                  </p>
                  <button
                    type="button"
                    onClick={feed.refresh}
                    className="rounded-full bg-icy-blue-400 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                Array.from({ length: 5 }, (_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-2xl border border-daintree-700 p-3"
                  >
                    <span className="h-10 w-10 animate-pulse rounded-full bg-daintree-700" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton />
                      <Skeleton />
                    </div>
                  </div>
                ))
              )
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <span className="text-base font-semibold text-white">
                  {emptyTitle}
                </span>
                <span className="text-sm text-daintree-400">{emptyBody}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-4">
                {items.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    onClick={() => setOpenId(item.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav />

      <BottomSheet
        title={open?.sheet.title ?? ""}
        // Figma 14040:354795: date 8px under the title, 16 Regular #c1d5de.
        subtitle={open?.sheet.subtitle}
        subtitleClassName="mt-2 pl-0 text-base tracking-normal text-daintree-200"
        // Header inset = card inset (16px), so title/date/divider line up with it.
        headerClassName="px-4"
        titleClassName="pl-0"
        bodyClassName="px-4"
        open={!!open}
        onClose={() => setOpenId(undefined)}
      >
        {open && <ActivityDetail item={open} />}
      </BottomSheet>
    </div>
  );
}
