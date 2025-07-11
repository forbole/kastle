import SendTransaction from "./SendTransaction";
import Splash from "@/components/screens/Splash";
import useWalletSigner from "@/hooks/evm/useWalletSigner";

export default function HotWalletSendTransaction() {
  const walletSigner = useWalletSigner();

  return (
    <>
      {!walletSigner && <Splash />}
      {walletSigner && <SendTransaction walletSigner={walletSigner} />}
    </>
  );
}
