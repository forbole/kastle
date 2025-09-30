import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { Hex, Address, hexToNumber } from "viem";
import { fetcher } from "@/lib/utils.ts";
import useSWR from "swr";

export type Erc20InfoFromApi = {
  decimals: number;
  name: string;
  symbol: string;
  icon_url: string;
};

export default function useErc20InfoFromApi(
  chainId: Hex,
  contractAddress: Address,
) {
  const currentChain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (chain) => chain.id === hexToNumber(chainId),
  );

  const { data } = useSWR<Erc20InfoFromApi>(
    currentChain
      ? `${currentChain.apiUrl}/api/v2/tokens/${contractAddress}`
      : null,
    fetcher,
  );
  return data;
}
