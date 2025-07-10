import SignTypedDataV4 from "./SignTypedDataV4";
import Splash from "@/components/screens/Splash";
import useWalletSigner from "@/hooks/evm/useWalletSigner";

type SignTypedDataV4Props = {
  requestId: string;
  payload: string;
};

export default function HotWalletSignMessage({
  requestId,
  payload,
}: SignTypedDataV4Props) {
  const walletSigner = useWalletSigner();

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
