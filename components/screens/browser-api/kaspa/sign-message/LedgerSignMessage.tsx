import { SignMessagePayload } from "@/api/background/handlers/kaspa/signMessage";
import Splash from "@/components/screens/Splash";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import SignMessage from "@/components/screens/browser-api/kaspa/sign-message/SignMessage";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignMessagePayload;
};

export default function LedgerSignMessage({
  requestId,
  payload,
}: LedgerSignTxProps) {
  const { transport, isAppOpen } = useLedgerTransport();
  const walletSigner = useKaspaLedgerSigner();

  return (
    <>
      {(!transport || !isAppOpen) && (
        <LedgerConnectForSign showClose={false} showPrevious={false} />
      )}
      {transport && isAppOpen && !walletSigner && <Splash />}
      {walletSigner && isAppOpen && (
        <SignMessage
          walletSigner={walletSigner}
          requestId={requestId}
          message={payload}
        />
      )}
    </>
  );
}
