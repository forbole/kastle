import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { storage } from "wxt/storage";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useSettings } from "@/hooks/useSettings.ts";
import { NetworkType } from "@/contexts/SettingsContext";
import type { Kcc20Token } from "@/lib/kcc20";
import { fetchStandardMarketPrice } from "@/lib/kcc20/providers/kascov";
import { fetchKronMarkets, type KronMarkets } from "@/lib/kcc20/swap";
import { fillFromKrc20 } from "@/lib/kcc20/krc20Fill";
import {
  useZealousSwapTokensMetadata,
  ZEALOUS_SWAP_IMAGE_URL,
} from "@/hooks/evm/provider/useZealousSwap";

/** `token` as shown: empty metadata fields filled from its KRC-20 namesake (display only). */
export function useKrc20FilledToken<T extends Kcc20Token | undefined>(
  token: T,
): T {
  const { data } = useZealousSwapTokensMetadata();
  return useMemo(
    () =>
      (token &&
        fillFromKrc20(
          token,
          data?.tokens.map((t) => ({
            symbol: t.symbol,
            decimals: t.decimals,
            logoURI: t.logoURI && `${ZEALOUS_SWAP_IMAGE_URL}${t.logoURI}`,
          })),
        )) as T,
    [token, data],
  );
}

type PriceCache = { networkId: string; prices: Record<string, number> };

// Network in the key, so a testnet price is never read back on mainnet.
const cacheKey = (networkId: string) =>
  `local:cache:kcc20Prices:${networkId}` as const;

// In-memory mirror, so every row on the dashboard reads the same load.
let mirror: PriceCache | undefined;

async function loadPrices(networkId: string): Promise<PriceCache> {
  const prices =
    (await storage.getItem<Record<string, number>>(cacheKey(networkId))) ?? {};
  // A merge may have landed while the read was in flight.
  if (mirror?.networkId === networkId)
    mirror = { networkId, prices: { ...prices, ...mirror.prices } };
  else mirror = { networkId, prices };
  return mirror;
}

async function mergePrice(networkId: string, covenantId: string, kas: number) {
  if (mirror?.networkId !== networkId) mirror = { networkId, prices: {} };
  if (mirror.prices[covenantId] === kas) return;
  mirror = { networkId, prices: { ...mirror.prices, [covenantId]: kas } };
  await storage.setItem(cacheKey(networkId), mirror.prices);
}

/** KAS per whole token: a live curve or a graduated pool. Undefined for a token KRON has no market for. */
export function kcc20PriceKas(
  markets: KronMarkets | undefined,
  covenantId: string,
): number | undefined {
  if (!markets) return;
  const market =
    markets.find((m) => m.covenantId === covenantId) ??
    markets.graduated.find((g) => g.covenantId === covenantId);
  return market?.priceKas;
}

/** What useKcc20Price has fetched for a token; undefined means not answered yet. */
export type Kcc20PriceSources = {
  markets?: KronMarkets;
  /** kascov's spot in KAS; null when kascov has no market for the token. */
  spot?: number | null;
  /** The KRC-20 list, USD prices by symbol. */
  krc20?: readonly { symbol: string; price: number }[];
  kaspaPrice: number;
  /** The token's last price cached under the current network. */
  cached?: number;
};

/**
 * useKcc20Price's resolution, for a screen that prices many tokens at once:
 * `live` is the sources' answer, `priceKas` the price shown.
 */
export function resolveKcc20Price(
  token: Pick<Kcc20Token, "covenantId" | "family" | "meta">,
  { markets, spot, krc20, kaspaPrice, cached }: Kcc20PriceSources,
): { live?: number; priceKas?: number } {
  const isStandard = token.family === "kcc20-standard";
  // No kascov market: the KRC-20 list's USD price for the same symbol (one entry only).
  const symbol = token.meta?.symbol.toUpperCase();
  const namesakes = symbol
    ? (krc20 ?? []).filter((t) => t.symbol.toUpperCase() === symbol)
    : [];
  const krc20Kas =
    namesakes.length === 1 && namesakes[0].price > 0 && kaspaPrice
      ? namesakes[0].price / kaspaPrice
      : undefined;
  const live = isStandard
    ? (spot ?? krc20Kas)
    : kcc20PriceKas(markets, token.covenantId);
  // null is an answer: kascov has no market, so no cached price may stand in.
  const answered = isStandard ? spot !== undefined : markets !== undefined;
  return { live, priceKas: answered ? live : cached };
}

/** The prices cached under `networkId`; a cold start reads them from storage. */
export function useKcc20CachedPrices(
  networkId: string | undefined,
): Record<string, number> | undefined {
  const [cache, setCache] = useState(mirror);

  // A cold start shows the last price until the source answers.
  useEffect(() => {
    if (!networkId || cache?.networkId === networkId) return;
    let active = true;
    loadPrices(networkId).then((entry) => {
      if (active) setCache(entry);
    });
    return () => {
      active = false;
    };
  }, [cache, networkId]);

  // Only a price cached under the current network may stand in.
  return cache && cache.networkId === networkId ? cache.prices : undefined;
}

export function useKcc20Price(
  token: Pick<Kcc20Token, "covenantId" | "family" | "meta">,
) {
  const { covenantId, meta } = token;
  const { kaspaPrice } = useKaspaPrice();
  const [settings] = useSettings();
  const networkId = settings?.networkId;
  const isMainnet = networkId === NetworkType.Mainnet;
  const isStandard = token.family === "kcc20-standard";
  // Same key as the swap screen, so both share one download.
  const { data: markets } = useSWR(
    isMainnet && !isStandard ? "kronMarkets" : null,
    fetchKronMarkets,
    { refreshInterval: 60_000 },
  );
  // KRON lists no standard token: kascov's own market prices it, mainnet only.
  // Without verified decimals there is no scale to price a whole token at.
  const { data: spot } = useSWR(
    isMainnet && isStandard && meta?.decimals !== undefined
      ? ["kascovMarket", covenantId, meta.decimals]
      : null,
    ([, id, decimals]) => fetchStandardMarketPrice(id, decimals),
    { refreshInterval: 60_000 },
  );
  const { data: krc20 } = useZealousSwapTokensMetadata();
  const cache = useKcc20CachedPrices(networkId);
  const { live, priceKas } = resolveKcc20Price(token, {
    markets,
    spot,
    krc20: krc20?.tokens,
    kaspaPrice,
    cached: cache?.[covenantId],
  });

  useEffect(() => {
    if (networkId && live !== undefined)
      mergePrice(networkId, covenantId, live).catch(() => {});
  }, [live, covenantId, networkId]);

  return {
    priceKas,
    // The KAS price reads 0 until it loads: unknown, not worthless.
    priceUsd:
      priceKas === undefined || !kaspaPrice ? undefined : priceKas * kaspaPrice,
  };
}
