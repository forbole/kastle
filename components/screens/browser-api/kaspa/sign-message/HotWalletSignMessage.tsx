import { SignMessagePayload } from "@/api/background/handlers/kaspa/signMessage";
import SignMessage from "@/components/screens/browser-api/kaspa/sign-message/SignMessage";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import Splash from "@/components/screens/Splash.tsx";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

type HotWalletSignMessageProps = {
  requestId: string;
  payload: SignMessagePayload;
};

export default function HotWalletSignMessage({
  requestId,
  payload,
}: HotWalletSignMessageProps) {
  const { rpcClient, networkId: rpcNetworkId } = useRpcClientStateful();
  const walletSigner = useKaspaHotWalletSigner();
  const loading = !rpcClient || !walletSigner || !rpcNetworkId;

  return (
    <>
      {loading && <Splash />}
      {!loading && (
        <SignMessage
          walletSigner={walletSigner}
          requestId={requestId}
          message={payload}
        />
      )}
    </>
  );
}
