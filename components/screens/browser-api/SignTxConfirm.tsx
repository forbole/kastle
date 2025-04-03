import { SignTxPayloadSchema } from "@/api/message";
import HotWalletSignTx from "@/components/screens/browser-api/sign-tx/HotWalletSignTx";
import LedgerSignTx from "@/components/screens/browser-api/sign-tx/LedgerSignTx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiResponse } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
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
        <HotWalletSignTx requestId={requestId} payload={parsedPayload} />
      )}
      {!loading && wallet.type === "ledger" && (
        <LedgerSignTx requestId={requestId} payload={parsedPayload} />
      )}
    </div>
  );
}
