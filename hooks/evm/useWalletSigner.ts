import React, { useEffect, useState } from "react";
import useKeyring from "@/hooks/useKeyring";
import useWalletManager from "@/hooks/useWalletManager";
import {
  LegacyAccountFactory,
  AccountFactory,
} from "@/lib/ethereum/wallet/account-factory";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import { useSettings } from "@/hooks/useSettings";

export default function useWalletSigner() {
  const { getWalletSecret } = useKeyring();
  const { wallet: walletInfo, account } = useWalletManager();
  const [walletSigner, setWalletSigner] = useState<IWallet>();
  const [settings] = useSettings();

  useEffect(() => {
    const init = async () => {
      if (!walletInfo || !account || !settings) {
        return;
      }

      const { walletSecret } = await getWalletSecret({
        walletId: walletInfo.id,
      });
      switch (walletInfo.type) {
        case "mnemonic":
          if (settings.isLegacyEvmAddressEnabled) {
            setWalletSigner(
              LegacyAccountFactory.createFromMnemonic(
                walletSecret.value,
                account.index,
              ),
            );
          } else {
            setWalletSigner(
              AccountFactory.createFromMnemonic(
                walletSecret.value,
                account.index,
              ),
            );
          }
          break;
        case "privateKey":
          setWalletSigner(
            AccountFactory.createFromPrivateKey(walletSecret.value),
          );
          break;
      }
    };
    init();
  }, [walletInfo, account, settings]);

  return walletSigner;
}
