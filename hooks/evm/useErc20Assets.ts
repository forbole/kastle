import useWalletManager from "../useWalletManager";
import useEvmAssets from "./useEvmAssets";
import { useState, useEffect } from "react";

export default function useErc20Assets() {
  const { account } = useWalletManager();
  const { evmAssets: walletsAssets } = useEvmAssets();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(!account);
  }, [account]);

  return {
    assets: account ? walletsAssets?.[account.address]?.erc20 || [] : [],
    isLoading: loading,
  };
}
