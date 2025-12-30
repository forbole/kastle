import {
  http,
  createPublicClient,
  numberToHex,
  Hex,
  formatEther,
  Address,
} from "viem";
import useEvmAddress from "./useEvmAddress";
import useSWR from "swr";
import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { useSettings } from "../useSettings";

export default function useEvmKasBalance(chainId?: Hex) {
  const balancesResult = useEvmKasBalances();

  if (!balancesResult.data || !chainId) {
    return {
      data: undefined,
      error: balancesResult.error,
      isLoading: balancesResult.isLoading,
      isValidating: balancesResult.isValidating,
      mutate: balancesResult.mutate,
    };
  }

  const balanceData = balancesResult.data[chainId];

  return {
    data: balanceData,
    error: balancesResult.error,
    isLoading: balancesResult.isLoading,
    isValidating: balancesResult.isValidating,
    mutate: balancesResult.mutate,
  };
}

export function useEvmKasBalancesByAddress(evmAddress?: Address) {
  const [settings] = useSettings();

  const chains =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const fetcher = async () => {
    if (!evmAddress || chains.length === 0) {
      return {};
    }

    const balances: Record<string, { rawBalance: bigint; balance: string }> =
      {};

    for (const chain of chains) {
      const chainId = numberToHex(chain.id);
      const client = createPublicClient({
        chain,
        transport: http(),
      });

      try {
        const rawBalance = await client.getBalance({
          address: evmAddress as `0x${string}`,
        });
        balances[chainId] = {
          rawBalance,
          balance: formatEther(rawBalance),
        };
      } catch (error) {
        console.error(`Error fetching balance for chain ${chainId}:`, error);
        balances[chainId] = {
          rawBalance: 0n,
          balance: "0",
        };
      }
    }

    return balances;
  };

  return useSWR(
    evmAddress && chains.length > 0
      ? `kasBalances:${settings?.networkId}-${evmAddress}`
      : null,
    evmAddress ? fetcher : null,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}

export function useEvmKasBalances() {
  const evmAddress = useEvmAddress();
  return useEvmKasBalancesByAddress(evmAddress);
}
