import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import LedgerNotSupported from "@/components/screens/browser-api/kaspa/LedgerNotSupported";
import SignTx from "@/components/screens/browser-api/kaspa/sign-tx/SignTx";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import { ApiUtils } from "@/api/background/utils";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";
import useLedgerTransport from "@/hooks/useLedgerTransport";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function LedgerSignTx({
  requestId,
  payload,
}: LedgerSignTxProps) {
  const { transport, isAppOpen } = useLedgerTransport();
  const walletSigner = useKaspaLedgerSigner();

  if (payload.scripts) {
    ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(
        requestId,
        null,
        "Ledger does not support advanced scripts signing",
      ),
    );
    return <LedgerNotSupported />;
  }

  return (
    <>
      {(!transport || !isAppOpen) && (
        <LedgerConnectForSign showClose={false} showPrevious={false} />
      )}
      {transport && isAppOpen && !walletSigner && <Splash />}
      {walletSigner && isAppOpen && (
        <SignTx wallet={walletSigner} requestId={requestId} payload={payload} />
      )}
    </>
  );
}
