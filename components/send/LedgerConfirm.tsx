import { useEffect, useState } from "react";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { ConfirmStep } from "@/components/send/ConfirmStep";
import { IWallet } from "@/lib/wallet/wallet-interface";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import { useNavigate } from "react-router-dom";

type LedgerConfirmProps = {
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
};

export default function LedgerConfirm({
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: LedgerConfirmProps) {
  const navigate = useNavigate();

  const { rpcClient, networkId } = useRpcClientStateful();
  const [walletSigner, setWalletSigner] = useState<IWallet>();
  const { walletSettings } = useWalletManager();
  const { transport, isAppOpen } = useLedgerTransport();

  // Build wallet signer
  useEffect(() => {
    if (
      !walletSettings ||
      !rpcClient ||
      !networkId ||
      !transport ||
      !isAppOpen
    ) {
      return;
    }

    const buildWallet = async () => {
      if (!walletSettings?.selectedWalletId) {
        onFail();
        return;
      }

      const accountFactory = new AccountFactory(rpcClient, networkId);
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const signer = accountFactory.createFromLedger(transport, accountIndex);

      setWalletSigner(signer);
    };

    buildWallet();
  }, [walletSettings, rpcClient, networkId, transport, isAppOpen]);

  return (
    <>
      {(!transport || !isAppOpen) && (
        <LedgerConnectForSign
          onBack={onBack}
          onClose={() => {
            navigate("/dashboard");
          }}
        />
      )}

      {transport && isAppOpen && (
        <ConfirmStep
          onNext={onNext}
          setOutTxs={setOutTxs}
          onFail={onFail}
          onBack={onBack}
          walletSigner={walletSigner}
        />
      )}
    </>
  );
}
