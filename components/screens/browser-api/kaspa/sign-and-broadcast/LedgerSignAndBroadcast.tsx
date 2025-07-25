import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import LedgerNotSupported from "@/components/screens/browser-api/kaspa/LedgerNotSupported";
import SignAndBroadcast from "@/components/screens/browser-api/kaspa/sign-and-broadcast/SignAndBroadcast";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";

type LedgerSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function LedgerSignAndBroadcast({
  requestId,
  payload,
}: LedgerSignAndBroadcastProps) {
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
        <SignAndBroadcast
          wallet={walletSigner}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
