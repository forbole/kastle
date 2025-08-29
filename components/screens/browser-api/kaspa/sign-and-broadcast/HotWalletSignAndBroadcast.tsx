import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import SignAndBroadcast from "@/components/screens/browser-api/kaspa/sign-and-broadcast/SignAndBroadcast";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import Splash from "@/components/screens/Splash.tsx";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

type HotWalletSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function HotWalletSignAndBroadcast({
  requestId,
  payload,
}: HotWalletSignAndBroadcastProps) {
  const { wallet: walletInfo, account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const walletSigner = useKaspaHotWalletSigner();
  const loading =
    !rpcClient || !walletSigner || !walletInfo || !account || !networkId;

  return (
    <>
      {loading && <Splash />}
      {!loading && (
        <SignAndBroadcast
          wallet={walletSigner}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
