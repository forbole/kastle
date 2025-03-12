import { SignTxPayload } from "@/api/message";
import HotWalletSignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/HotWalletSignAndBroadcast";
import LedgerSignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/LedgerSignAndBroadcast";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { useEffect } from "react";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";
import Splash from "@/components/screens/Splash";

export default function SignAndBroadcastTxConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? SignTxPayload.fromUriString(encodedPayload)
    : null;

  const loading = !wallet || !requestId || !payload;

  useEffect(() => {
    // Handle beforeunload event
    async function beforeunload(event: BeforeUnloadEvent) {
      const denyMessage = new ApiResponse(requestId, false, "User denied");
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
        <HotWalletSignAndBroadcast requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignAndBroadcast requestId={requestId} payload={payload} />
      )}
    </div>
  );
}
