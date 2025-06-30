import { useEffect, useState } from "react";
import { ConfirmStep } from "@/components/send/evm/erc20-send/ConfirmStep";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useKeyring from "@/hooks/useKeyring";
import { AccountFactory } from "@/lib/ethereum/wallet/account-factory";
import { Erc20Asset } from "@/contexts/EvmAssets";

type HotWalletConfirmProps = {
  asset: Erc20Asset;
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
};

export default function HotWalletConfirm({
  asset,
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: HotWalletConfirmProps) {
  const [walletSigner, setWalletSigner] = useState<IWallet>();
  const { getWalletSecret } = useKeyring();
  const { walletSettings } = useWalletManager();

  // Build wallet signer
  useEffect(() => {
    if (!walletSettings) {
      return;
    }

    const buildWallet = async () => {
      if (!walletSettings?.selectedWalletId) {
        onFail();
        return;
      }

      const { walletSecret: secret } = await getWalletSecret({
        walletId: walletSettings.selectedWalletId,
      });
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const signer =
        secret.type === "mnemonic"
          ? AccountFactory.createFromMnemonic(secret.value, accountIndex)
          : AccountFactory.createFromPrivateKey(secret.value);

      setWalletSigner(signer);
    };

    buildWallet();
  }, [walletSettings]);

  return (
    <ConfirmStep
      asset={asset}
      onNext={onNext}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onBack={onBack}
      walletSigner={walletSigner}
    />
  );
}
