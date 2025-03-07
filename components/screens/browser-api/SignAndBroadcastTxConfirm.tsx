import { SignAndBroadcastTxPayload } from "@/api/message";
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
    ? SignAndBroadcastTxPayload.fromUriString(encodedPayload)
    : null;

  const loading = !wallet || !requestId || !payload;

  return (
    <>
      {loading && <>Loading</>}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignAndBroadcast requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && <LedgerSignAndBroadcast />}
    </>
  );
}
