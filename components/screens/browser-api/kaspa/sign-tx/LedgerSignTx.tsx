import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import LedgerNotSupported from "@/components/screens/browser-api/kaspa/LedgerNotSupported";
import SignTx from "@/components/screens/browser-api/kaspa/sign-tx/SignTx";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import { ApiUtils } from "@/api/background/utils";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function LedgerSignTx({
  requestId,
  payload,
}: LedgerSignTxProps) {
  const { transport, isAppOpen } = useLedgerTransport();
  const { rpcClient } = useRpcClientStateful();

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

  const wallet =
    rpcClient && transport
      ? new AccountFactory(
          rpcClient,
          payload.networkId as NetworkType,
        ).createFromLedger(transport)
      : null;

  return (
    <>
      {(!transport || !isAppOpen) && (
        <LedgerConnectForSign showClose={false} showPrevious={false} />
      )}
      {transport && isAppOpen && !wallet && <Splash />}
      {wallet && isAppOpen && (
        <SignTx wallet={wallet} requestId={requestId} payload={payload} />
      )}
    </>
  );
}
