import { useEffect, useState } from "react";
import { WalletSecret } from "@/types/WalletSecret";
import LedgerSending from "@/components/send/LedgerSending";
import HotWalletSending from "@/components/send/HotWalletSending";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

interface SendingProps {
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
}

export default function Sending({
  setOutTxs,
  onFail,
  onSuccess,
}: SendingProps) {
  const { rpcClient } = useRpcClientStateful();
  const [settings] = useSettings();
  const [secret, setSecret] = useState<WalletSecret>();
  const { getWalletSecret } = useKeyring();
  const { walletSettings } = useWalletManager();

  useEffect(() => {
    if (!walletSettings?.selectedWalletId) {
      return;
    }

    getWalletSecret({
      walletId: walletSettings.selectedWalletId,
    }).then(({ walletSecret }) => setSecret(walletSecret));
  }, [walletSettings]);

  const accountFactory =
    !rpcClient || !settings
      ? undefined
      : new AccountFactory(rpcClient, settings.networkId);

  return (
    <>
      {secret &&
        accountFactory &&
        (secret.type === "ledger" ? (
          <LedgerSending
            accountFactory={accountFactory}
            secret={secret}
            setOutTxs={setOutTxs}
            onFail={onFail}
            onSuccess={onSuccess}
          />
        ) : (
          <HotWalletSending
            accountFactory={accountFactory}
            secret={secret}
            setOutTxs={setOutTxs}
            onFail={onFail}
            onSuccess={onSuccess}
          />
        ))}
    </>
  );
}
