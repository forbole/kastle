import { SignTxPayloadSchema } from "@/api/background/handlers/kaspa/utils";
import HotWalletSignAndBroadcast from "@/components/screens/browser-api/kaspa/sign-and-broadcast/HotWalletSignAndBroadcast";
import LedgerSignAndBroadcast from "@/components/screens/browser-api/kaspa/sign-and-broadcast/LedgerSignAndBroadcast";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import Splash from "@/components/screens/Splash";

export default function SignAndBroadcastTxConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? JSON.parse(decodeURIComponent(encodedPayload))
    : null;

  const parsedPayload = payload ? SignTxPayloadSchema.parse(payload) : null;

  const loading = !wallet || !requestId || !parsedPayload;

  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignAndBroadcast
          requestId={requestId}
          payload={parsedPayload}
        />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignAndBroadcast requestId={requestId} payload={parsedPayload} />
      )}
    </div>
  );
}
