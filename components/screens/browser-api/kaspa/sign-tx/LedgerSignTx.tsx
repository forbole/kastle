import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import LedgerNotSupported from "@/components/screens/browser-api/kaspa/LedgerNotSupported";
import SignTx from "@/components/screens/browser-api/kaspa/sign-tx/SignTx";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import { ApiUtils } from "@/api/background/utils";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import { hasScriptOptions } from "@/lib/wallet/sign-script.ts";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

export default function LedgerSignTx({
  requestId,
  payload,
  origin,
}: LedgerSignTxProps) {
  const { transport, isAppOpen } = useLedgerTransport();
  const walletSigner = useKaspaLedgerSigner();

  // scripts defaults to [] in the payload schema, so gate on actual script
  // options — a bare truthy check would refuse every Ledger request.
  if (hasScriptOptions(payload.scripts)) {
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
        <SignTx
          wallet={walletSigner}
          requestId={requestId}
          payload={payload}
          origin={origin}
        />
      )}
    </>
  );
}
