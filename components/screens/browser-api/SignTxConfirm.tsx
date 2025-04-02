import { SignTxPayload } from "@/api/message";
import HotWalletSignTx from "@/components/screens/browser-api/sign-tx/HotWalletSignTx";
import LedgerSignTx from "@/components/screens/browser-api/sign-tx/LedgerSignTx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";
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
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignTx requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignTx requestId={requestId} payload={payload} />
      )}
    </div>
  );
}
