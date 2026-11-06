import { useEffect, useState } from "react";
import useSWR from "swr";
import { storage } from "wxt/storage";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useSettings } from "@/hooks/useSettings.ts";
import { NetworkType } from "@/contexts/SettingsContext";
import type { Kcc20Token } from "@/lib/kcc20";
import { fetchStandardMarketPrice } from "@/lib/kcc20/providers/kascov";
import { fetchKronMarkets, type KronMarkets } from "@/lib/kcc20/swap";

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
  const [cache, setCache] = useState(mirror);
  const live = isStandard
    ? (spot ?? undefined)
    : kcc20PriceKas(markets, covenantId);
  // null is an answer: kascov has no market, so no cached price may stand in.
  const answered = isStandard ? spot !== undefined : markets !== undefined;

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

  useEffect(() => {
    if (networkId && live !== undefined)
      mergePrice(networkId, covenantId, live).catch(() => {});
  }, [live, covenantId, networkId]);

  // Only a price cached under the current network may stand in.
  const cached =
    cache && cache.networkId === networkId
      ? cache.prices[covenantId]
      : undefined;
  const priceKas = answered ? live : cached;
  return {
    priceKas,
    // The KAS price reads 0 until it loads: unknown, not worthless.
    priceUsd:
      priceKas === undefined || !kaspaPrice ? undefined : priceKas * kaspaPrice,
  };
}
