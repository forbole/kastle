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

  const { transport, isAppOpen } = useLedgerTransport();
  const { rpcClient } = useRpcClientStateful();

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
        <SignAndBroadcast
          walletType="ledger"
          wallet={wallet}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
