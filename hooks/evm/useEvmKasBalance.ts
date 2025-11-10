import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { http, createPublicClient, numberToHex, formatUnits } from "viem";
import useEvmAddress from "./useEvmAddress";
import useSWR from "swr";

export default function useEvmKasBalance(
  chainId?: `0x${string}`,
  decimals = 18,
) {
  const evmAddress = useEvmAddress();
  const fetcher = async () => {
    if (!evmAddress) {
      return undefined;
    }

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
      address: evmAddress as `0x${string}`,
    });
    return {
      rawBalance,
      balance: formatUnits(rawBalance, decimals),
    };
  };

  return useSWR(
    evmAddress ? `kasBalance:${chainId}-${evmAddress}` : null,
    evmAddress ? fetcher : null,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
