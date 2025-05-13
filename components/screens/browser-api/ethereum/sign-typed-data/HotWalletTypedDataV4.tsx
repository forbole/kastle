import SignTypedDataV4 from "./SignTypedDataV4";
import useWalletManager from "@/hooks/useWalletManager";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import { useEffect, useState } from "react";
import useKeyring from "@/hooks/useKeyring";
import { AccountFactory } from "@/lib/ethereum/wallet/account-factory";
import Splash from "@/components/screens/Splash";

type SignMessageProps = {
  requestId: string;
  payload: string;
};

export default function HotWalletSignMessage({
  requestId,
  payload,
}: SignMessageProps) {
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
      {!isLoading && (
        <SignTypedDataV4
          requestId={requestId}
          walletSigner={walletSigner}
          message={payload}
        />
      )}
    </>
  );
}
