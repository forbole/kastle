import { http, createPublicClient, formatEther } from "viem";
import useEvmAddress from "./useEvmAddress";
import useSWR from "swr";
import { useSettings } from "../useSettings";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";

export default function useEvmKasBalances() {
  const evmAddress = useEvmAddress();
  const [settings] = useSettings();
  const supportedChains =
    settings?.networkId === "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const fetcher = async () => {
    if (!evmAddress) {
      return {};
    }

    const balances = await Promise.all(
      supportedChains.map((chain) => {
        const client = createPublicClient({
          chain,
          transport: http(),
        });

        return client.getBalance({
          address: evmAddress as `0x${string}`,
        });
      }),
    );

    const total = balances.reduce(
      (acc, balance) => acc + BigInt(balance),
      BigInt(0),
    );

    return {
      rawBalance: total,
      balance: formatEther(total),
    };
  };

  return useSWR(
    evmAddress ? `kasBalance:evm-${evmAddress}` : null,
    evmAddress ? fetcher : null,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
