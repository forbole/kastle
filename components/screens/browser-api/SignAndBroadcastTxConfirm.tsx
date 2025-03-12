import { SignTxPayload } from "@/api/message";
import HotWalletSignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/HotWalletSignAndBroadcast";
import LedgerSignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/LedgerSignAndBroadcast";
import useWalletManager from "@/hooks/useWalletManager.ts";

export default function SignAndBroadcastTxConfirm() {
  const { wallet } = useWalletManager();
  const requestId = new URLSearchParams(window.location.search).get(
    "requestId",
  );
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? SignTxPayload.fromUriString(encodedPayload)
    : null;

  const loading = !wallet || !requestId || !payload;

  return (
    <div className="h-screen p-4">
      {loading && <>Loading</>}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignAndBroadcast requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignAndBroadcast requestId={requestId} payload={payload} />
      )}
    </div>
  );
}
