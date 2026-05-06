import useSWR from "swr";
import { useEffect, useState } from "react";
import { createPublicClient, http, erc20Abi, Hex, Address } from "viem";
import { numberToHex, formatUnits } from "viem";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import useEvmAddress from "./useEvmAddress";
import useErc20TokensFromApi from "./useErc20TokensFromApi";
import { useSettings } from "@/hooks/useSettings";
import {
  erc20BalanceCache,
  type Erc20BalanceCacheItem,
} from "@/lib/cache/erc20BalanceCache";

export default function useErc20Balance(tokenAddress: string, chainId: string) {
  const balancesResult = useErc20Balances();

  if (!balancesResult.data) {
    return {
      data: undefined,
      error: balancesResult.error,
      isLoading: balancesResult.isLoading,
      isValidating: balancesResult.isValidating,
      mutate: balancesResult.mutate,
    };
  }

  // Find the balance data by tokenAddress and chainId
  const balanceData = balancesResult.data.find(
    (item) =>
      item.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase() &&
      item.chainId === chainId,
  );

  // Check if balance data has error
  const hasError = balanceData && "error" in balanceData;

  return {
    data: hasError ? undefined : balanceData,
    error: hasError
      ? new Error(
          (balanceData as { error: string }).error || "Failed to fetch balance",
        )
      : balancesResult.error,
    isLoading: balancesResult.isLoading,
    isValidating: balancesResult.isValidating,
    mutate: balancesResult.mutate,
  };
}

export function useErc20BalancesByAddress(evmAddress?: Address) {
  const [settings] = useSettings();
  const [cacheReady, setCacheReady] = useState(false);
  const { data: erc20TokensData } = useErc20TokensFromApi();

  const cacheKey = evmAddress
    ? `${settings?.networkId ?? "mainnet"}:${evmAddress}`
    : null;

  useEffect(() => {
    if (!cacheKey) return;
    erc20BalanceCache.load(cacheKey).then(() => setCacheReady(true));
  }, [cacheKey]);

  const cachedRaw = cacheKey ? erc20BalanceCache.read(cacheKey) : null;
  // Reconstruct full shape: rawBalance placeholder 0n
  const fallbackData: ReturnType<typeof buildFallback> | undefined =
    cacheReady && cachedRaw != null ? buildFallback(cachedRaw) : undefined;

  // Use all tokens from useErc20TokensFromApi
  const tokensToFetch =
    erc20TokensData
      ?.filter((chain) => chain.success)
      .flatMap((chain) =>
        chain.tokens.map((token) => ({
          tokenAddress: token.token.address_hash as Address,
          decimals: parseInt(token.token.decimals || "18", 10),
          chainId: chain.chainId,
        })),
      ) ?? [];

  const fetcher = async () => {
    if (!evmAddress || tokensToFetch.length === 0) {
      return [];
    }

    const balancePromises = tokensToFetch.map(
      async ({ tokenAddress, decimals, chainId }) => {
        const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
          (c) => numberToHex(c.id) === chainId,
        );
        if (!chain) {
          return {
            error: `Unsupported chain ID: ${chainId}`,
          };
        }

        const client = createPublicClient({
          chain,
          transport: http(),
        });

        try {
          const rawBalance = await client.readContract({
            address: tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [evmAddress],
          });
          return {
            tokenAddress,
            chainId,
            decimals,
            rawBalance,
            balance: parseFloat(formatUnits(rawBalance, decimals)),
          };
        } catch (error) {
          console.error(`Error fetching balance for ${tokenAddress}:`, error);
          return {
            error: `Failed to fetch balance: ${(error as Error).message}`,
          };
        }
      },
    );

    return Promise.all(balancePromises);
  };

  const key =
    evmAddress && erc20TokensData && erc20TokensData.length > 0
      ? `erc-20-balances:${evmAddress}`
      : null;

  return useSWR(key, evmAddress ? fetcher : null, {
    fallbackData,
    keepPreviousData: true,
    refreshInterval: 5_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 2_000,
    onSuccess: (items) => {
      if (!cacheKey || !items) return;
      // Only cache successful items — avoid persisting failed fetches as 0
      const successful: Erc20BalanceCacheItem[] = items
        .filter(
          (
            item,
          ): item is {
            tokenAddress: Address;
            chainId: Hex;
            decimals: number;
            rawBalance: bigint;
            balance: number;
          } =>
            !("error" in item) &&
            item.tokenAddress != null &&
            item.chainId != null,
        )
        .map(({ tokenAddress, chainId, decimals, balance }) => ({
          tokenAddress,
          chainId,
          decimals,
          balance,
        }));
      erc20BalanceCache.write(cacheKey, successful);
    },
  });
}

function buildFallback(cached: Erc20BalanceCacheItem[]) {
  return cached.map((item) => ({
    ...item,
    chainId: item.chainId as Hex,
    rawBalance: 0n,
  }));
}

export function useErc20Balances() {
  const evmAddress = useEvmAddress();
  return useErc20BalancesByAddress(evmAddress);
}
