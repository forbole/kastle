import useWalletManager from "../wallet/useWalletManager";
import useEvmAssets from "./useEvmAssets";
import { useState, useEffect } from "react";
import useErc20TokensFromApi from "./useErc20TokensFromApi";
import { Erc20Asset } from "@/contexts/EvmAssets";

export default function useErc20Assets() {
  const { account } = useWalletManager();
  const { evmAssets: walletsAssets } = useEvmAssets();
  const [loading, setLoading] = useState(false);
  const { data: erc20TokensData, isLoading } = useErc20TokensFromApi();

  useEffect(() => {
    setLoading(!account);
  }, [account]);

  const assetsFromStore = account && walletsAssets?.[account.address]?.erc20;

  // Get only new assets from the API that are not already in the store
  const assetItemsFromApi = erc20TokensData
    ?.filter((data) => data.success)
    .filter((data) => data.tokens.length > 0)
    .flatMap((data) =>
      data.tokens.map((token) => ({ ...token, chainId: data.chainId })),
    )
    .filter(
      (data) =>
        !assetsFromStore?.find(
          (asset) =>
            asset.address.toLowerCase() ===
              data.token.address_hash.toLowerCase() &&
            asset.chainId === data.chainId,
        ),
    );

  // Format assets from API to match Erc20Asset type
  const assetsFromApiFormatted: Erc20Asset[] | undefined =
    assetItemsFromApi?.map((item) => ({
      address: item.token.address_hash,
      symbol: item.token.symbol,
      decimals: parseInt(item.token.decimals, 10),
      image: item.token.icon_url,
      chainId: item.chainId,
    }));

  const assets = [
    ...(assetsFromStore || []),
    ...(assetsFromApiFormatted || []),
  ];

  console.log(assets);

  return {
    assets,
    isLoading: loading || isLoading,
  };
}
