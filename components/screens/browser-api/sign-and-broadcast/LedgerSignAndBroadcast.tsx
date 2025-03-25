import { SignTxPayload } from "@/api/message";
import LedgerNotSupported from "@/components/screens/browser-api/sign/LedgerNotSupported";
import SignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/SignAndBroadcast";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";

type LedgerSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function LedgerSignAndBroadcast({
  requestId,
  payload,
}: LedgerSignAndBroadcastProps) {
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

  const ledgerOnError = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      new ApiResponse(requestId, null, "Ledger error, please try again"),
    );
    window.close();
  };

  return (
    <>
      {(!transport || !isAppOpen) && (
        <LedgerConnectForSign
          showClose={false}
          showPrevious={false}
          onBack={ledgerOnError}
        />
      )}
      {transport && isAppOpen && !wallet && <Splash />}
      {wallet && isAppOpen && (
        <SignAndBroadcast
          wallet={wallet}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
