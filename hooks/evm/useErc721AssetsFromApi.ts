import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { useSettings } from "@/hooks/useSettings";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/utils";
import { NftAsset } from "@/lib/nft/erc721";
import { numberToHex } from "viem";

type NftPageResponse = {
  items: NftAsset[];
  next_page_params?: Record<string, any>;
};

type ChainNftPageResponse = NftPageResponse & {
  chainId: string;
  chainIndex: number;
};

export default function useErc721AssetsFromApi() {
  const [settings] = useSettings();
  const chains =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;
  const address = useEvmAddress();

  const getKey = (
    pageIndex: number,
    previousPageData: ChainNftPageResponse | null,
  ) => {
    if (!address || !chains?.length) return null;

    let currentChainIndex = 0;

    if (pageIndex === 0) {
      currentChainIndex = 0;
    } else if (previousPageData) {
      if (previousPageData.next_page_params) {
        currentChainIndex = previousPageData.chainIndex;
      } else {
        currentChainIndex = previousPageData.chainIndex + 1;
      }
    }

    if (currentChainIndex >= chains.length) return null;

    const chain = chains[currentChainIndex];
    const baseUrl = `${chain.apiUrl}/api/v2/addresses/${address}/nft`;
    const params = new URLSearchParams();

    params.append("type", "ERC-721,ERC-1155,ERC-404");

    if (
      previousPageData?.next_page_params &&
      previousPageData.chainIndex === currentChainIndex
    ) {
      Object.entries(previousPageData.next_page_params).forEach(
        ([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, value);
          }
        },
      );
    }

    return {
      url: `${baseUrl}?${params.toString()}`,
      chainId: numberToHex(chain.id),
      chainIndex: currentChainIndex,
    };
  };

  const result = useSWRInfinite<ChainNftPageResponse, Error>(
    getKey,
    async (keyData: { url: string; chainId: string; chainIndex: number }) => {
      const response = (await fetcher(keyData.url)) as NftPageResponse;

      return {
        ...response,
        chainId: keyData.chainId,
        chainIndex: keyData.chainIndex,
      };
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    },
  );

  const hasNextPage =
    result.data && result.data.length > 0
      ? !!result.data[result.data.length - 1]?.next_page_params ||
        result.data[result.data.length - 1]?.chainIndex < chains.length - 1
      : false;

  return {
    ...result,
    hasNextPage,
  };
}
