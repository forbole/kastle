import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { Address, Hex, hexToNumber } from "viem";
import { kasplexMainnet, igraMainnet } from "@/lib/layer2";

const KASPA_COM_API_URL =
  "https://api-defi.kaspa.com/dex/graph-pairs?network=kasplex";
const KASPA_LFG_API_URL =
  "https://api-defi.kaspa.com/explorer/lfg-tokens/search";
const KASPA_IPFS_BASE_URL = "https://ipfs.lfg.kaspa.com/ipfs/";

interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  totalSupply: string;
  decimals: string;
  derivedKAS: string;
}

interface Pair {
  id: string;
  token0: TokenInfo;
  token1: TokenInfo;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  reserveKAS: string;
  token0Price: string;
  token1Price: string;
  volumeKAS: string;
  txCount: string;
  createdAtTimestamp: string;
}

type KaspaComApiResponse = Pair[];

interface KaspaLfgToken {
  tokenAddress: string;
  deployerAddress: string;
  ticker: string;
  name: string;
  description: string;
  totalSupply: number;
  socials: {
    telegram?: string;
    website?: string;
    twitter?: string;
  };
  image: string;
  colorHex: string;
  devLock: string;
  isHypedLaunch: boolean;
  bondingCurve: string;
  state: string;
  decimals: number;
  version: number;
  isNSFW: boolean;
  txHash: string;
  price: number;
  marketCap: number;
  volume: {
    "1h": number;
    "4h": number;
    "12h": number;
    "1d": number;
    "3d": number;
    "7d": number;
    all: number;
  };
  priceChange: {
    "1h": number;
    "4h": number;
    "12h": number;
    "1d": number;
    "3d": number;
    "7d": number;
    all: number;
  };
  progress: number;
  holderCount: number;
  tradeCount: {
    buys: number;
    sells: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface KaspaLfgApiResponse {
  success: boolean;
  result: KaspaLfgToken[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export function useKaspaComTokensMetadata() {
  return useSWR<KaspaComApiResponse>(KASPA_COM_API_URL, fetcher, {
    refreshInterval: 60_000, // Refresh every minute
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
}

export function useKaspaComTokens() {
  const { data, error, isLoading } = useKaspaComTokensMetadata();

  // Extract all unique tokens from pairs
  const tokens = data?.reduce((acc, pair) => {
    const token0Id = pair.token0.id.toLowerCase();
    const token1Id = pair.token1.id.toLowerCase();

    if (!acc.has(token0Id)) {
      acc.set(token0Id, pair.token0);
    }

    if (!acc.has(token1Id)) {
      acc.set(token1Id, pair.token1);
    }

    return acc;
  }, new Map<string, TokenInfo>());

  return {
    data: tokens ? Array.from(tokens.values()) : undefined,
    error,
    isLoading,
  };
}

export function useErc20ImageFromKaspaCom(
  chainId: Hex,
  contractAddress: Address,
) {
  const numericChainId = hexToNumber(chainId);
  const isKasplex = numericChainId === kasplexMainnet.id;
  const isIgra = numericChainId === igraMainnet.id;
  const network = isKasplex ? "kasplex" : isIgra ? "igra" : undefined;

  const apiUrl = network
    ? `${KASPA_LFG_API_URL}?search=${contractAddress}&network=${network}`
    : null;

  const { data, error, isLoading } = useSWR<KaspaLfgApiResponse>(
    apiUrl,
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    },
  );

  if (!network) {
    return { logoUrl: undefined, error: "Unsupported chain", isLoading: false };
  }

  const token =
    data?.success && data.result.length > 0
      ? data.result.find(
          (t) => t.tokenAddress.toLowerCase() === contractAddress.toLowerCase(),
        )
      : undefined;

  const logoUrl = token?.image
    ? `${KASPA_IPFS_BASE_URL}${token.image}`
    : undefined;

  return {
    logoUrl,
    error,
    isLoading,
  };
}

// Helper function to build IPFS URL from image hash
export function useErc20ImageFromKaspa(imageHash?: string): string | undefined {
  return imageHash ? `${KASPA_IPFS_BASE_URL}${imageHash}` : undefined;
}
