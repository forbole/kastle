import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import SignTx from "@/components/screens/browser-api/kaspa/sign-tx/SignTx";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import Splash from "@/components/screens/Splash.tsx";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

type HotWalletSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function HotWalletSignTx({
  requestId,
  payload,
}: HotWalletSignAndBroadcastProps) {
  const { rpcClient, networkId: rpcNetworkId } = useRpcClientStateful();
  const walletSigner = useKaspaHotWalletSigner();
  const loading = !rpcClient || !walletSigner || !rpcNetworkId;

  return (
    <>
      {loading && <Splash />}
      {!loading && (
        <SignTx wallet={walletSigner} requestId={requestId} payload={payload} />
      )}
    </>
  );
}
