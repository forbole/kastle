import useSWR from "swr";
import {
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { useSettings } from "@/hooks/useSettings";
import { Address, numberToHex } from "viem";
import useEvmAddress from "@/hooks/evm/useEvmAddress";

type ERC20TokenItem = {
  value: string;
  token: {
    address_hash: Address;
    name: string;
    symbol: string;
    decimals: string;
    icon_url?: string;
  };
};

const fetchAllERC20TokensForChain = async (
  apiUrl: string,
  address: Address,
) => {
  let allItems: ERC20TokenItem[] = [];
  let nextPageParams = null;
  let hasNextPage = true;

  while (hasNextPage) {
    let url = `${apiUrl}/api/v2/addresses/${address}/tokens`;

    const params = new URLSearchParams();
    params.append("type", "ERC-20");

    if (nextPageParams) {
      Object.entries(nextPageParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          params.append(key, value.toString());
        }
      });
    }

    url += `?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ERC-20 tokens: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();

    allItems = [...allItems, ...data.items];

    if (data.next_page_params) {
      nextPageParams = data.next_page_params;
    } else {
      hasNextPage = false;
    }
  }

  return allItems;
};

export default function useErc20TokensFromApi() {
  const [settings] = useSettings();
  const chains =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;
  const address = useEvmAddress();

  return useSWR(
    address && chains?.length > 0
      ? ["multi-chain-erc20-tokens", address, chains.map((c) => c.id)]
      : null,
    async ([_, address, chainIds]) => {
      const fetchChainERC20Tokens = async (chainId: number) => {
        try {
          const currentChain = chains.find((chain) => chain.id === chainId);
          const explorerApi = currentChain?.apiUrl;
          if (!explorerApi) {
            throw new Error(
              `No explorer API configured for chain ID ${chainId}`,
            );
          }
          const tokens = await fetchAllERC20TokensForChain(
            explorerApi,
            address,
          );
          return {
            chainId: numberToHex(chainId),
            success: true,
            tokens,
          };
        } catch (error) {
          return {
            chainId: numberToHex(chainId),
            success: false,
            error: (error as Error).message,
            tokens: [],
          };
        }
      };

      return Promise.all(
        chainIds.map((chainId) => fetchChainERC20Tokens(chainId)),
      );
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    },
  );
}
