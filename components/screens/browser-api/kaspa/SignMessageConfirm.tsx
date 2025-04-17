import { SignMessagePayloadSchema } from "@/api/background/handlers/kaspa/signMessage";
import HotWalletSignMessage from "@/components/screens/browser-api/kaspa/sign-message/HotWalletSignMessage";
import LedgerSignMessage from "@/components/screens/browser-api/kaspa/sign-message/LedgerSignMessage";
import useWalletManager from "@/hooks/useWalletManager.ts";
import Splash from "@/components/screens/Splash";

export default function SignMessageConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? JSON.parse(decodeURIComponent(encodedPayload))
    : null;

  const parsedPayload = payload
    ? SignMessagePayloadSchema.parse(payload)
    : null;

  const loading = !wallet || !requestId || !parsedPayload;

  return (
    <div className="h-screen p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignMessage
          requestId={requestId}
          payload={SignMessagePayloadSchema.parse(parsedPayload)}
        />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignMessage
          requestId={requestId}
          payload={SignMessagePayloadSchema.parse(parsedPayload)}
        />
      )}
    </div>
  );
}
