import SendTransaction from "./SendTransaction";
import Splash from "@/components/screens/Splash";
import useEvmHotWalletSigner from "@/hooks/evm/useEvmHotWalletSigner";

export default function HotWalletSendTransaction() {
  const walletSigner = useEvmHotWalletSigner();

  return (
    <>
      {!walletSigner && <Splash />}
      {walletSigner && <SendTransaction walletSigner={walletSigner} />}
    </>
  );
}
