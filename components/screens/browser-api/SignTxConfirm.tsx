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

  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? SignTxPayload.fromUriString(encodedPayload)
    : null;

  const loading = !wallet || !requestId || !payload;

  return (
    <>
      {loading && <>Loading</>}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignTx requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && <LedgerSignTx />}
    </>
  );
}
