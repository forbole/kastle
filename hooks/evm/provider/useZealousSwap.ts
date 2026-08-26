import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { Address, Hex, hexToNumber } from "viem";
import { ALL_SUPPORTED_EVM_L2_CHAINS, igraMainnet } from "@/lib/layer2";

const ZEALOUS_SWAP_KASPLEX_API_URL =
  "https://kasplex.zealousswap.com/v1/tokens";
const ZEALOUS_SWAP_IGRA_URL = "https://igra.zealousswap.com/v1/tokens";
export const ZEALOUS_SWAP_IMAGE_URL =
  "https://cdn-zealous-swap.fra1.cdn.digitaloceanspaces.com/kasplex/tokens/";
export const ZEALOUS_SWAP_IGRA_IMAGE_URL =
  "https://cdn-zealous-swap.fra1.cdn.digitaloceanspaces.com/igra/tokens/";

interface TokenMetadata {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
  logoURI: string;
  verified: boolean;
  price: number;
  rank: number;
}

interface ZealousSwapApiResponse {
  tokens: TokenMetadata[];
}

export function useZealousSwapTokensMetadata() {
  return useSWR<ZealousSwapApiResponse>(ZEALOUS_SWAP_KASPLEX_API_URL, fetcher, {
    refreshInterval: 60_000, // Refresh every minute
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
}

export function useZealousSwapIgraTokensMetadata() {
  return useSWR<ZealousSwapApiResponse>(ZEALOUS_SWAP_IGRA_URL, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
}

export function useErc20ImageFromZealousSwap(
  chainId: Hex,
  contractAddress: Address,
) {
  const numericChainId = hexToNumber(chainId);
  const isIgra = numericChainId === igraMainnet.id;

  const kasplex = useZealousSwapTokensMetadata();
  const igra = useZealousSwapIgraTokensMetadata();

  const { data, error, isLoading } = isIgra ? igra : kasplex;
  const imageBaseUrl = isIgra
    ? ZEALOUS_SWAP_IGRA_IMAGE_URL
    : ZEALOUS_SWAP_IMAGE_URL;

  const isSupported = ALL_SUPPORTED_EVM_L2_CHAINS.map(
    (chain) => chain.id,
  ).includes(numericChainId);

  if (!isSupported) {
    return { logoUrl: undefined, error: "Unsupported chain", isLoading: false };
  }

  const normalizedAddress = contractAddress.toLowerCase() as Address;
  const token = data?.tokens.find(
    (t) => t.address.toLowerCase() === normalizedAddress,
  );

  const logoUrl = token ? `${imageBaseUrl}${token.logoURI}` : undefined;

  return {
    logoUrl,
    error,
    isLoading,
  };
}
