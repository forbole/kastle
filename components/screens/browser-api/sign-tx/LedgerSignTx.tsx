import { SignTxPayload } from "@/api/message";
import LedgerNotSupported from "@/components/screens/browser-api/sign/LedgerNotSupported";
import SignTx from "@/components/screens/browser-api/sign-tx/SignTx";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";

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
      new ApiResponse(
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
