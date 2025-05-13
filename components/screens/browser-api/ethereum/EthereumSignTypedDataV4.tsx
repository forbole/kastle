import useWalletManager from "@/hooks/useWalletManager.ts";
import Splash from "@/components/screens/Splash";
import HotWalletSignTypedDataV4 from "@/components/screens/browser-api/ethereum/sign-typed-data/HotWalletTypedDataV4";

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
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignTypedDataV4 requestId={requestId} payload={payload} />
      )}
      {!loading && wallet.type === "ledger" && <>Not Supported</>}
    </div>
  );
}
