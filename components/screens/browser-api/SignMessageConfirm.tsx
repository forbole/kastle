import { SignMessagePayload } from "@/api/message";
import HotWalletSignMessage from "@/components/screens/browser-api/sign-message/HotWalletSignMessage";
import LedgerSignMessage from "@/components/screens/browser-api/sign-message/LedgerSignMessage";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { useEffect } from "react";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";
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

  const loading = !wallet || !requestId || !payload;
 
  return (
    <div className="h-screen p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignMessage requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignMessage requestId={requestId} payload={payload} />
      )}
    </div>
  );
}
