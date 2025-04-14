import HotWalletSignMessage from "@/components/screens/browser-api/ethereum/sign-message/HotWalletSignMessage";
import useWalletManager from "@/hooks/useWalletManager.ts";
import Splash from "@/components/screens/Splash";

export default function EthereumSignMessageConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload ? decodeURIComponent(encodedPayload) : null;

  const loading = !wallet || !requestId || !payload;

  return (
    <div className="h-screen p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignMessage requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && <>Not Supported</>}
    </div>
  );
}
