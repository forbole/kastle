import { Hex, Address } from "viem";
import useEvmAssets from "@/hooks/evm/useEvmAssets";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useErc20InfoFromApi from "./useErc20InfoFromApi";
import { Erc20Asset } from "@/contexts/EvmAssets";
import { useErc20ImageFromZealousSwap } from "@/hooks/evm/provider/useZealousSwap";
import { useErc20ImageFromKaspaCom } from "@/hooks/evm/provider/useKaspaCom";

/** Aggregates logo URLs from ZealousSwap and KaspaCom, prioritising ZealousSwap. */
export function useErc20Image(chainId: Hex, contractAddress: Address) {
  const zealousSwap = useErc20ImageFromZealousSwap(chainId, contractAddress);
  const kaspaCom = useErc20ImageFromKaspaCom(chainId, contractAddress);

  const isLoading = zealousSwap.isLoading || kaspaCom.isLoading;

  if (zealousSwap.logoUrl) {
    return {
      logoUrl: zealousSwap.logoUrl,
      error: zealousSwap.error,
      isLoading: zealousSwap.isLoading,
    };
  }

  if (kaspaCom.logoUrl) {
    return {
      logoUrl: kaspaCom.logoUrl,
      error: kaspaCom.error,
      isLoading: kaspaCom.isLoading,
    };
  }

  return {
    logoUrl: undefined,
    error: zealousSwap.error || kaspaCom.error,
    isLoading,
  };
}

export default function useErc20Info(
  chainId: Hex,
  contractAddress: Address,
): Erc20Asset | undefined {
  const { account } = useWalletManager();
  const { evmAssets } = useEvmAssets();
  const asset = evmAssets?.[account?.address ?? ""]?.erc20?.find(
    (a) =>
      a.address.toLowerCase() === contractAddress?.toLowerCase() &&
      a.chainId === chainId,
  );

  const apiData = useErc20InfoFromApi(chainId, contractAddress);
  const { logoUrl } = useErc20Image(chainId, contractAddress);

  const apiDataFormed: Erc20Asset | undefined = apiData
    ? {
        address: contractAddress as `0x${string}`,
        chainId: chainId as `0x${string}`,
        decimals: apiData.decimals,
        symbol: apiData.symbol,
        image: logoUrl ?? apiData.icon_url,
      }
    : undefined;

  return asset ? { ...asset, image: logoUrl ?? asset.image } : apiDataFormed;
}
