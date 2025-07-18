import { useState, useEffect } from "react";
import { IWallet } from "@/lib/wallet/wallet-interface";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useKeyring from "@/hooks/useKeyring";

export default function useWalletSigner() {
  const { getWalletSecret } = useKeyring();
  const { wallet: walletInfo, account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const [walletSigner, setWalletSigner] = useState<IWallet>();

  useEffect(() => {
    if (!rpcClient || !walletInfo || !networkId || !account) return;
    if (walletInfo.type !== "mnemonic" && walletInfo.type !== "privateKey") {
      throw new Error("Unsupported wallet type");
    }

    getWalletSecret({ walletId: walletInfo.id }).then(({ walletSecret }) => {
      const factory = new AccountFactory(rpcClient, networkId);

      switch (walletInfo.type) {
        case "mnemonic":
          setWalletSigner(
            factory.createFromMnemonic(walletSecret.value, account.index),
          );
          break;
        case "privateKey":
          setWalletSigner(factory.createFromPrivateKey(walletSecret.value));
          break;
      }
    });
  }, [rpcClient, walletInfo, account]);

  return walletSigner;
}
