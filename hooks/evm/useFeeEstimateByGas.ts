import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { http, createPublicClient, numberToHex, Hex } from "viem";
import useSWR from "swr";

// Common gas estimates for different operations
export const SWAP_GAS_ESTIMATES = {
  // ERC20 operations
  APPROVAL: 47_000n,

  // Swap operations (estimated ranges)
  KAS_TO_ERC20: 160_000n, // KAS -> ERC20 swap
  ERC20_TO_KAS: 170_000n, // ERC20 -> KAS swap
  ERC20_TO_ERC20: 250_000n, // ERC20 -> ERC20 swap
  WRAP: 28_000n, // WKAS wrap/unwrap operations
  UNWRAP: 36_000n, // WKAS unwrap operations
} as const;

const fetcher = (chainId: `0x${string}`, gas: bigint) => {
  return async () => {
    try {
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

      const gasFees = await client.estimateFeesPerGas();
      const { maxFeePerGas } = gasFees;

      return maxFeePerGas * gas;
    } catch (error) {
      console.error("Fee estimation by gas error:", error);
      throw error;
    }
  };
};

export default function useFeeEstimateByGas(
  gas?: bigint,
  chainId?: `0x${string}`,
) {
  const isLoading = !chainId || gas === undefined;

  return useSWR(
    isLoading ? null : `feeEstimateByGas:${chainId}-${gas.toString()}`,
    isLoading ? null : fetcher(chainId, gas),
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 2000, // Dedupe requests within 2 seconds
    },
  );
}
