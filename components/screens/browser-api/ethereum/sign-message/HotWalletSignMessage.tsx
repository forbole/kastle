import SignMessage from "@/components/screens/browser-api/ethereum/sign-message/SignMessage";
import Splash from "@/components/screens/Splash";
import useEvmHotWalletSigner from "@/hooks/evm/useEvmHotWalletSigner";

type SignMessageProps = {
  requestId: string;
  hexMessage: `0x${string}`;
};

export default function HotWalletSignMessage({
  requestId,
  hexMessage,
}: SignMessageProps) {
  const walletSigner = useEvmHotWalletSigner();

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
