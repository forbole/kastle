import { SignTxPayloadSchema } from "@/api/background/handlers/kaspa/utils";
import HotWalletSignTx from "@/components/screens/browser-api/kaspa/sign-tx/HotWalletSignTx";
import LedgerSignTx from "@/components/screens/browser-api/kaspa/sign-tx/LedgerSignTx";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import Splash from "@/components/screens/Splash";

export default function SignTxConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  if (!requestId) {
    throw new Error("No request id found");
  }

  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? JSON.parse(decodeURIComponent(encodedPayload))
    : null;

  const parsedPayload = SignTxPayloadSchema.parse(payload);
  const loading = !wallet || !requestId || !payload;

  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignTx requestId={requestId} payload={parsedPayload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignTx requestId={requestId} payload={parsedPayload} />
      )}
    </div>
  );
}
