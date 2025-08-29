import { ConfirmStep } from "@/components/send/kas-send/ConfirmStep";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import { useNavigate } from "react-router-dom";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";

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
  const { transport, isAppOpen } = useLedgerTransport();
  const walletSigner = useKaspaLedgerSigner();

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

      {transport && isAppOpen && walletSigner && (
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
