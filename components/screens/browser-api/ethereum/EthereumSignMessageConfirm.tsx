import HotWalletSignMessage from "@/components/screens/browser-api/ethereum/sign-message/HotWalletSignMessage";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { useEffect } from "react";
import { ApiExtensionUtils } from "@/api/extension";
import { RPC_ERRORS } from "@/api/message";
import Splash from "@/components/screens/Splash";
import { ApiUtils } from "@/api/background/utils";

export default function EthereumSignMessageConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? decodeURIComponent(encodedPayload)
    : null;

  const loading = !wallet || !requestId || !payload;

  useEffect(() => {
    // Handle beforeunload event
    async function beforeunload(event: BeforeUnloadEvent) {
      const denyMessage = ApiUtils.createApiResponse(requestId, false, RPC_ERRORS.USER_REJECTED_REQUEST);
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
        <HotWalletSignMessage requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <>Not Supported</>
      )}
    </div>
  );
}