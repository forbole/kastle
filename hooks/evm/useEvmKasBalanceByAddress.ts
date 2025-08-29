import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { http, createPublicClient, numberToHex, formatUnits } from "viem";
import useSWR from "swr";

export default function useEvmKasBalanceByAddress(
  address: `0x${string}`,
  chainId: `0x${string}`,
  decimals = 18,
) {
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
    refreshInterval: 10000, // Refresh every 10 seconds
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
}
