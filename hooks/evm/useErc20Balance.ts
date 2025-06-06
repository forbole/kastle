import useSWR from "swr";
import { createPublicClient, http, erc20Abi } from "viem";
import useWalletManager from "../useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import { numberToHex, formatUnits } from "viem";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";

export default function useERC20Balance(
  tokenAddress: string,
  decimals: number,
  chainId: string,
) {
  const { account } = useWalletManager();
  const publicKey = account?.publicKeys?.[0];
  const evmAddress = publicKey ? toEvmAddress(publicKey) : undefined;

  const fetcher = async () => {
    if (!evmAddress) {
      return {};
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

    const rawBalance = await client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [evmAddress],
    });
    return {
      rawBalance,
      balance: formatUnits(rawBalance, decimals),
    };
  };

  return useSWR(
    evmAddress ? `erc20Balance:${tokenAddress}:${evmAddress}-${chainId}` : null,
    evmAddress ? fetcher : null,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
