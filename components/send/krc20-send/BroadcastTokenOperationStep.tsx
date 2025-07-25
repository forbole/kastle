import { useEffect, useState } from "react";
import { WalletSecret } from "@/types/WalletSecret";
import { LegacyAccountFactory } from "@/lib/wallet/account-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import HotWalletBroadcastTokenOperation from "@/components/send/krc20-send/HotWalletBroadcastTokenOperation";
import useWalletManager from "@/hooks/wallet/useWalletManager";

interface SendingProps {
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
}

export default function BroadcastTokenOperationStep({
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
      : new LegacyAccountFactory(rpcClient, settings.networkId);

  return (
    <>
      {/* FIXME Ledger support */}
      {secret && accountFactory && (
        <HotWalletBroadcastTokenOperation
          accountFactory={accountFactory}
          secret={secret}
          setOutTxs={setOutTxs}
          onFail={onFail}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}
