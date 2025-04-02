import { SignMessagePayload } from "@/api/message";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import Splash from "@/components/screens/Splash";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import SignMessage from "@/components/screens/browser-api/sign-message/SignMessage";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignMessagePayload;
};

export default function LedgerSignMessage({
  requestId,
  payload,
}: LedgerSignTxProps) {
  const { transport, isAppOpen } = useLedgerTransport();
  const { rpcClient, networkId } = useRpcClientStateful();

  const wallet =
    rpcClient && transport
      ? new AccountFactory(
          rpcClient,
          networkId ?? ("mainnet" as NetworkType),
        ).createFromLedger(transport)
      : null;

  return (
    <>
      {(!transport || !isAppOpen) && (
        <LedgerConnectForSign showClose={false} showPrevious={false} />
      )}
      {transport && isAppOpen && !wallet && <Splash />}
      {wallet && isAppOpen && (
        <SignMessage
          walletSigner={wallet}
          requestId={requestId}
          message={payload.message}
        />
      )}
    </>
  );
}
