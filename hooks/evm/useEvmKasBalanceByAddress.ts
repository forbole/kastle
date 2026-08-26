import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { http, createPublicClient, numberToHex, formatUnits } from "viem";
import useSWR from "swr";
import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { evmKasBalanceCache } from "@/lib/cache/evmKasBalanceCache";

export default function useEvmKasBalanceByAddress(
  address: `0x${string}`,
  chainId: `0x${string}`,
  decimals = 18,
) {
  const [settings] = useSettings();
  const [cacheReady, setCacheReady] = useState(false);

  // This hook reads the same multi-chain cache entry written by useEvmKasBalances
  // but never writes — a single-chain hook must not overwrite multi-chain data.
  const cacheKey = address
    ? `${settings?.networkId ?? "mainnet"}:${address}`
    : null;

  useEffect(() => {
    if (!cacheKey) return;
    evmKasBalanceCache.load(cacheKey).then(() => setCacheReady(true));
  }, [cacheKey]);

  const cachedEntry = cacheKey ? evmKasBalanceCache.read(cacheKey) : null;
  const cachedBalance = cachedEntry?.[chainId];
  const fallbackData =
    cacheReady && cachedBalance != null
      ? { rawBalance: 0n, balance: cachedBalance }
      : undefined;

  const fetcher = async () => {
    const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
      (c) => numberToHex(c.id) === chainId,
    );
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const client = createPublicClient({
      chain,
      transport: http(),
    });

    const rawBalance = await client.getBalance({
      address,
    });
    return {
      rawBalance,
      balance: formatUnits(rawBalance, decimals),
    };
  };

  return useSWR(`kasBalance:${chainId}-${address}`, fetcher, {
    fallbackData,
    keepPreviousData: true,
    refreshInterval: 10000, // Refresh every 10 seconds
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
}
