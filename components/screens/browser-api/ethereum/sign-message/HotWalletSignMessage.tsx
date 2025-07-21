import SignMessage from "@/components/screens/browser-api/ethereum/sign-message/SignMessage";
import Splash from "@/components/screens/Splash";
import useWalletSigner from "@/hooks/evm/useWalletSigner";

type SignMessageProps = {
  requestId: string;
  hexMessage: `0x${string}`;
};

export default function HotWalletSignMessage({
  requestId,
  hexMessage,
}: SignMessageProps) {
  const walletSigner = useWalletSigner();

  return (
    <>
      {!walletSigner && <Splash />}
      {walletSigner && (
        <SignMessage
          requestId={requestId}
          walletSigner={walletSigner}
          hexMessage={hexMessage}
        />
      )}
    </>
  );
}
