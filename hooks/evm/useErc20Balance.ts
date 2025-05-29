import useSWR from "swr";
import { createPublicClient, http, erc20Abi } from "viem";
import useWalletManager from "../useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import { kairos } from "viem/chains";
import { Chain, hexToNumber, formatUnits } from "viem";

const CHAIN_MAP: Record<number, Chain> = {
  [kairos.id]: kairos,
};

export default function useERC20Balance(
  address: string,
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

    const chain = CHAIN_MAP[hexToNumber(chainId as `0x${string}`)];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const client = createPublicClient({
      chain,
      transport: http(),
    });

    const rawBalance = await client.readContract({
      address: address as `0x${string}`,
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
    evmAddress ? `erc20Balance:${address}:${evmAddress}-${chainId}` : null,
    evmAddress ? fetcher : null,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
