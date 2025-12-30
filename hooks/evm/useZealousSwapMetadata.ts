import { Address, Hex, hexToNumber } from "viem";
import { kasplexMainnet } from "@/lib/layer2";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";

const ZEALOUS_SWAP_API_URL = "https://kasplex.zealousswap.com/v1/tokens";
const ZEALOUS_SWAP_IMAGE_URL =
  "https://cdn-zealous-swap.fra1.cdn.digitaloceanspaces.com/kasplex/tokens/";

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
  return useSWR<ZealousSwapApiResponse>(ZEALOUS_SWAP_API_URL, fetcher, {
    refreshInterval: 60_000, // Refresh every minute
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
}

export function useErc20Image(chainId: Hex, contractAddress: Address) {
  const { data, error, isLoading } = useZealousSwapTokensMetadata();

  const numericChainId = hexToNumber(chainId);
  const isKasplex = numericChainId === kasplexMainnet.id;

  if (!isKasplex) {
    return { logoUrl: undefined, error: "Unsupported chain", isLoading: false };
  }

  const normalizedAddress = contractAddress.toLowerCase() as Address;
  const token = data?.tokens.find(
    (t) => t.address.toLowerCase() === normalizedAddress,
  );

  const logoUrl = token
    ? `${ZEALOUS_SWAP_IMAGE_URL}${token.logoURI}`
    : undefined;

  return {
    logoUrl,
    error,
    isLoading,
  };
}

export function useErc20Price(chainId: Hex, contractAddress: Address) {
  const { data: tokens, error, isLoading } = useErc20Prices();

  const numericChainId = hexToNumber(chainId);
  const isKasplex = numericChainId === kasplexMainnet.id;

  if (!isKasplex) {
    return {
      price: 0,
      error: undefined,
      isLoading: false,
    };
  }

  const normalizedAddress = contractAddress.toLowerCase() as Address;
  const token = tokens?.find(
    (t) => t.address.toLowerCase() === normalizedAddress,
  );

  return {
    price: token?.price ?? 0,
    error,
    isLoading,
  };
}

export function useErc20Prices() {
  const { data, error, isLoading } = useZealousSwapTokensMetadata();

  return {
    data: data?.tokens,
    error,
    isLoading,
  };
}
