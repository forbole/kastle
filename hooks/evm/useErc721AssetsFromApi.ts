import { Address } from "viem";
import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  EvmChain,
} from "@/lib/layer2";
import { useSettings } from "@/hooks/useSettings";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useSWRInfinite from "swr/infinite";
import { fetcher, emptyFetcher } from "@/lib/utils";

type Attribute = {
  trait_type: string;
  value: string;
};

export type NftAsset = {
  id: string;
  image_url?: string;
  metadata?: {
    attributes?: Attribute[];
    description?: string;
    name?: string;
  };
  token: {
    address_hash: Address;
    type?: "ERC-721" | "ERC-1155" | "ERC-404";
    name?: string;
    symbol?: string;
  };
  amount: string;
  value?: string; // For ERC-1155 (quantity) and ERC-404 (balance)
};

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
  const address = "0x7cc0cffdA9146832f68820a47d7a97A4581B0452";
  // TODO: Enable below line after the feature is tested
  // const address = useEvmAddress();

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
      chainId: chain.id.toString(),
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
