import useSWR from "swr";
import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";
import { krc20BalanceCache } from "@/lib/cache/krc20BalanceCache";

export type TokenListItem = {
  ca?: string;
  tick?: string;

  balance: string;
  locked: string;
  dec: string;
  opScoreMod: string;
};

export type TokenListResponse = {
  message: string;
  prev: string;
  next: string;
  result: TokenListItem[] | undefined;
};

export type TokenItem = {
  id: string;
  dec: string;
  balance: string;
};

/** Fetch all pages for a given address from the Kasplex token-list endpoint. */
async function fetchAllTokensForAddress(
  kasplexUrl: string,
  address: string,
): Promise<TokenItem[]> {
  const allItems: TokenListItem[] = [];
  let next: string | undefined;

  do {
    const url = next
      ? `${kasplexUrl}/krc20/address/${address}/tokenlist?next=${next}`
      : `${kasplexUrl}/krc20/address/${address}/tokenlist`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Kasplex tokenlist: ${res.status}`);
    const data: TokenListResponse = await res.json();

    if (data.result) allItems.push(...data.result);
    next = data.next || undefined;
  } while (next);

  return allItems.map(({ ca, tick, dec, balance }) => ({
    id: (tick ?? ca) as string,
    dec,
    balance,
  }));
}

export function useTokenListByAddress(
  address?: string,
  refreshInterval?: number,
) {
  const [settings] = useSettings();
  const [cacheReady, setCacheReady] = useState(false);

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  useEffect(() => {
    if (!address) return;
    krc20BalanceCache.load(address).then(() => setCacheReady(true));
  }, [address]);

  const cached = address ? krc20BalanceCache.read(address) : null;

  const { data } = useSWR<TokenItem[], Error>(
    kasplexUrl && address ? `krc20Tokens:${address}` : null,
    () => fetchAllTokensForAddress(kasplexUrl!, address!),
    {
      fallbackData: cacheReady && cached != null ? cached : undefined,
      keepPreviousData: true,
      refreshInterval,
      onSuccess: (tokens) => {
        if (address) krc20BalanceCache.write(address, tokens);
      },
    },
  );

  return data;
}
