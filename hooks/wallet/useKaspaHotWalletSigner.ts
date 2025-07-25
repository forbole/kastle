import { useState, useEffect } from "react";
import { IWallet } from "@/lib/wallet/wallet-interface";
import {
  LegacyAccountFactory,
  AccountFactory,
} from "@/lib/wallet/account-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useKeyring from "@/hooks/useKeyring";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function useKaspaHotWalletSigner() {
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
      const isLegacyEnabled = walletInfo.isLegacyWalletEnabled ?? true; // Default to true if not specified
      const factory = isLegacyEnabled
        ? new LegacyAccountFactory(rpcClient, networkId)
        : new AccountFactory(rpcClient, networkId);

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
