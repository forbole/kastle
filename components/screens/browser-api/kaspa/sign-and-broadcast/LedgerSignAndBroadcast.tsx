import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import LedgerNotSupported from "@/components/screens/browser-api/kaspa/LedgerNotSupported";
import SignAndBroadcast from "@/components/screens/browser-api/kaspa/sign-and-broadcast/SignAndBroadcast";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";
import {
  hasScriptOptions,
  hasUnsignableFields,
} from "@/lib/wallet/sign-script.ts";
import { deserializeTransaction } from "@/lib/kaspa-compat";

type LedgerSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

// Approved refusal copy for unsignable-field requests (A1 addendum). ONE
// constant feeds BOTH the dApp rejection and the on-screen detail so the two
// reasons can never drift apart.
export const LEDGER_UNSIGNABLE_FIELDS_MESSAGE =
  "Ledger can't verify this transaction's memo, time lock, or other advanced fields yet. Try a hot wallet account instead.";

export default function LedgerSignAndBroadcast({
  requestId,
  payload,
  origin,
}: LedgerSignAndBroadcastProps) {
  const { transport, isAppOpen } = useLedgerTransport();
  const walletSigner = useKaspaLedgerSigner();

  const scripted = hasScriptOptions(payload.scripts);

  // KAS-002 defect A1: the Ledger app signs over zeroed lockTime / input
  // sequence / gas / subnetworkId / payload (and forces SIGHASH_ALL) no
  // matter what the transaction carries — hw-app-kaspa never sends those
  // fields over the wire. A request using any of them would still get a
  // VALID signature, but over the zeroed rewrite: the user approves one
  // transaction and a different one broadcasts. Refuse BEFORE any device
  // interaction. A txJson that cannot be deserialized cannot be proven
  // safe, so it is refused the same way. Unblock: KAS-002 A2 (Ledger
  // app/firmware support for these fields).
  const unsignable = useMemo(() => {
    try {
      return hasUnsignableFields(deserializeTransaction(payload.txJson));
    } catch {
      return true;
    }
  }, [payload.txJson]);

  const refusalMessage = scripted
    ? "Ledger does not support advanced scripts signing"
    : unsignable
      ? LEDGER_UNSIGNABLE_FIELDS_MESSAGE
      : undefined;

  // Dispatch outside the render phase and once per mount: React can render
  // this component more than once, and each requestId must produce exactly
  // one rejection response.
  const sentRef = useRef(false);
  useEffect(() => {
    if (!refusalMessage || sentRef.current) return;
    sentRef.current = true;
    ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, null, refusalMessage),
    );
  }, [requestId, refusalMessage]);

  if (scripted) {
    return <LedgerNotSupported />;
  }

  if (unsignable) {
    return (
      <LedgerNotSupported
        subtitle="This transaction can't be verified on your Ledger."
        detail={LEDGER_UNSIGNABLE_FIELDS_MESSAGE}
      />
    );
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
          origin={origin}
        />
      )}
    </>
  );
}
