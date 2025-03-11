import { SignTxPayload } from "@/api/message";
import LedgerNotSupported from "@/components/screens/browser-api/sign/LedgerNotSupported";
import { useNavigate } from "react-router-dom";
import SignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/SignAndBroadcast";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import Splash from "@/components/screens/Splash";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";

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

  const navigate = useNavigate();
  const { transport, isAppOpen } = useLedgerTransport();
  const { rpcClient } = useRpcClientStateful();

  useEffect(() => {
    if (!transport || !isAppOpen) {
      const currentUrl = new URL(window.location.href);
      const pathname = window.location.hash.replace(/#/, "");
      navigate({
        pathname: "/ledger-connect-for-sign",
        search: `?redirect=${pathname}${encodeURIComponent(currentUrl.search)}`,
      });
      return;
    }
  }, [transport]);

  const wallet =
    rpcClient && transport
      ? new AccountFactory(
          rpcClient,
          payload.networkId as NetworkType,
        ).createFromLedger(transport)
      : null;

  return wallet ? (
    <SignAndBroadcast wallet={wallet} requestId={requestId} payload={payload} />
  ) : (
    <Splash />
  );
}
