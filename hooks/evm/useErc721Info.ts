import useSWR from "swr";
import { Hex, Address } from "viem";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { fetcher, emptyFetcher } from "@/lib/utils";
import { NftAsset } from "@/lib/nft/erc721";

export default function useErc721Info(
  chainId?: Hex,
  contractAddress?: Address,
  tokenId?: string,
) {
  const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (c) => c.id === Number(chainId),
  );
  const apiUrl = chain?.apiUrl;
  const fetchUrl =
    apiUrl && contractAddress && tokenId
      ? `${apiUrl}/api/v2/tokens/${contractAddress}/instances/${tokenId}`
      : null;

  return useSWR<NftAsset>(fetchUrl, fetchUrl ? fetcher : emptyFetcher);
}
