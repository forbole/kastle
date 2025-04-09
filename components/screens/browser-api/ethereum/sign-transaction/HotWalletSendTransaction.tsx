import React, { useEffect, useState } from "react";
import useKeyring from "@/hooks/useKeyring";
import useWalletManager from "@/hooks/useWalletManager";
import { AccountFactory } from "@/lib/ethereum/wallet/account-factory";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import SendTransaction from "./SendTransaction";
import Splash from "@/components/screens/Splash";

export default function HotWalletSendTransaction() {
  const { getWalletSecret } = useKeyring();
  const { wallet: walletInfo, account } = useWalletManager();
  const [walletSigner, setWalletSigner] = useState<IWallet | null>(null);

  useEffect(() => {
    const init = async () => {
      if (!walletInfo || !account) {
        return;
      }

      const { walletSecret } = await getWalletSecret({
        walletId: walletInfo.id,
      });
      switch (walletInfo.type) {
        case "mnemonic":
          setWalletSigner(
            AccountFactory.createFromMnemonic(
              walletSecret.value,
              account.index,
            ),
          );
          break;
        case "privateKey":
          setWalletSigner(
            AccountFactory.createFromPrivateKey(walletSecret.value),
          );
          break;
      }
    };
    init();
  }, [getWalletSecret]);

  const isLoading = !walletSigner;
  return (
    <>
      {isLoading && <Splash />}
      {!isLoading && <SendTransaction walletSigner={walletSigner} />}
    </>
  );
}
