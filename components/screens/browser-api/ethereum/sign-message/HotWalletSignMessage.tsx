import SignMessage from "@/components/screens/browser-api/ethereum/sign-message/SignMessage";
import Splash from "@/components/screens/Splash";
import useWalletSigner from "@/hooks/evm/useWalletSigner";

type SignMessageProps = {
  requestId: string;
  payload: string;
};

export default function HotWalletSignMessage({
  requestId,
  payload,
}: SignMessageProps) {
  const walletSigner = useWalletSigner();

  return (
    <>
      {!walletSigner && <Splash />}
      {walletSigner && (
        <SignMessage
          requestId={requestId}
          walletSigner={walletSigner}
          message={payload}
        />
      )}
    </>
  );
}
