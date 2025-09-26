import { Hex, Address } from "viem";
import useEvmAssets from "@/hooks/evm/useEvmAssets";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useErc20InfoFromApi from "./useErc20InfoFromApi";
import { Erc20Asset } from "@/contexts/EvmAssets";

export default function useErc20Info(
  chainId: Hex,
  contractAddress: Address,
): Erc20Asset | undefined {
  const { account } = useWalletManager();
  const { evmAssets } = useEvmAssets();
  const asset = evmAssets?.[account?.address ?? ""]?.erc20?.find(
    (asset) =>
      asset.address.toLowerCase() === contractAddress?.toLowerCase() &&
      asset.chainId === chainId,
  );

  const apiData = useErc20InfoFromApi(chainId, contractAddress);
  const apiDataFormed: Erc20Asset | undefined = apiData
    ? {
        address: contractAddress as `0x${string}`,
        chainId: chainId as `0x${string}`,
        decimals: apiData.decimals,
        symbol: apiData.symbol,
        image: apiData.icon_url,
      }
    : undefined;

  return asset ? asset : apiDataFormed;
}
