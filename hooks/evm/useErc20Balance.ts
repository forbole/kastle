import useSWR from "swr";
import { createPublicClient, http, erc20Abi, Hex, Address } from "viem";
import { numberToHex, formatUnits } from "viem";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import useEvmAddress from "./useEvmAddress";
import useErc20Assets from "./useErc20Assets";

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
  const { assets } = useErc20Assets();

  // Use all tokens from useErc20Tokens
  const tokensToFetch =
    assets?.map((asset) => {
      return {
        tokenAddress: asset.address,
        decimals: asset.decimals,
        chainId: asset.chainId,
      };
    }) ?? [];

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
    evmAddress && tokensToFetch && tokensToFetch.length > 0
      ? `erc-20-balances:${evmAddress}`
      : null;

  return useSWR(key, evmAddress ? fetcher : null, {
    refreshInterval: 5_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 2_000,
  });
}

export function useErc20Balances() {
  const evmAddress = useEvmAddress();
  return useErc20BalancesByAddress(evmAddress);
}
