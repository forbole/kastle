import SignTypedDataV4 from "./SignTypedDataV4";
import Splash from "@/components/screens/Splash";
import useEvmHotWalletSigner from "@/hooks/evm/useEvmHotWalletSigner";

type SignTypedDataV4Props = {
  requestId: string;
  payload: string;
};

export default function HotWalletSignMessage({
  requestId,
  payload,
}: SignTypedDataV4Props) {
  const walletSigner = useEvmHotWalletSigner();

  return (
    <>
      {!walletSigner && <Splash />}
      {walletSigner && (
        <SignTypedDataV4
          requestId={requestId}
          walletSigner={walletSigner}
          message={payload}
        />
      )}
    </>
  );
}
