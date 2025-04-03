import { SignTxPayloadSchema } from "@/api/message";
import HotWalletSignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/HotWalletSignAndBroadcast";
import LedgerSignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/LedgerSignAndBroadcast";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { useEffect } from "react";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
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

  useEffect(() => {
    // Handle beforeunload event
    async function beforeunload(event: BeforeUnloadEvent) {
      const denyMessage = ApiUtils.createApiResponse(
        requestId,
        false,
        "User denied",
      );
      await ApiExtensionUtils.sendMessage(requestId, denyMessage);
    }

    window.addEventListener("beforeunload", beforeunload);

    return () => {
      window.removeEventListener("beforeunload", beforeunload);
    };
  }, []);

  return (
    <div className="h-screen p-4">
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
