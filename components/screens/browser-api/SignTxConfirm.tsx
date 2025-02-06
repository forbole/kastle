import { SignTxPayload } from "@/api/message";
import HotWalletSignTx from "@/components/screens/browser-api/sign-tx/HotWalletSignTx";
import LedgerSignTx from "@/components/screens/browser-api/sign-tx/LedgerSignTx";
import useWalletManager from "@/hooks/useWalletManager.ts";

export default function SignTxConfirm() {
  const { wallet } = useWalletManager();
  const requestId = new URLSearchParams(window.location.search).get(
    "requestId",
  );
  if (!requestId) {
    throw new Error("No request id found");
  }

  // Retrieve the transaction payload from the URL
  const base64Encoded = new URLSearchParams(window.location.search).get(
    "payload",
  );
  if (!base64Encoded) {
    throw new Error("No transaction payload found");
  }
  const payload = SignTxPayload.fromBase64Url(base64Encoded);

  return (
    <>
      {!wallet && <>Loading</>}
      {wallet && wallet.type !== "ledger" ? (
        <HotWalletSignTx requestId={requestId} payload={payload} />
      ) : (
        <LedgerSignTx />
      )}
    </>
  );
}
