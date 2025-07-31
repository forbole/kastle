import HotWalletSignMessage from "@/components/screens/browser-api/ethereum/sign-message/HotWalletSignMessage";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import Splash from "@/components/screens/Splash";
import z from "zod";
import { isHex } from "viem";

export default function EthereumSignMessageConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? z.string().refine(isHex).parse(decodeURIComponent(encodedPayload))
    : null;

  const loading = !wallet || !requestId || !payload;

  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && (
        <HotWalletSignMessage requestId={requestId} hexMessage={payload} />
      )}
      {!loading && wallet.type === "ledger" && <>Not Supported</>}
    </div>
  );
}
