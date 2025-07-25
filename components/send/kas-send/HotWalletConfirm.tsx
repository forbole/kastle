import { useEffect, useState } from "react";
import { LegacyAccountFactory } from "@/lib/wallet/account-factory";
import { ConfirmStep } from "@/components/send/kas-send/ConfirmStep";
import { IWallet } from "@/lib/wallet/wallet-interface";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKeyring from "@/hooks/useKeyring";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

type HotWalletConfirmProps = {
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
};

export default function HotWalletConfirm({
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: HotWalletConfirmProps) {
  const { rpcClient, networkId } = useRpcClientStateful();
  const [walletSigner, setWalletSigner] = useState<IWallet>();
  const { getWalletSecret } = useKeyring();
  const { walletSettings } = useWalletManager();

  // Build wallet signer
  useEffect(() => {
    if (!walletSettings || !rpcClient || !networkId) {
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
      const accountFactory = new LegacyAccountFactory(rpcClient, networkId);
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const signer =
        secret.type === "mnemonic"
          ? accountFactory.createFromMnemonic(secret.value, accountIndex)
          : accountFactory.createFromPrivateKey(secret.value);

      setWalletSigner(signer);
    };

    buildWallet();
  }, [walletSettings, rpcClient, networkId]);

  return (
    <ConfirmStep
      onNext={onNext}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onBack={onBack}
      walletSigner={walletSigner}
    />
  );
}
