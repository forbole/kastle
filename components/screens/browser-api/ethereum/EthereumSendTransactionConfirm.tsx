import HotWalletSignTransaction from "@/components/screens/browser-api/ethereum/sign-transaction/HotWalletSendTransaction";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { useEffect } from "react";
import { ApiExtensionUtils } from "@/api/extension";
import { RPC_ERRORS } from "@/api/message";
import Splash from "@/components/screens/Splash";
import { ApiUtils } from "@/api/background/utils";

export default function EthereumSendTransactionConfirm() {
  const { wallet } = useWalletManager();
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";

  useEffect(() => {
    // Handle beforeunload event
    async function beforeunload(event: BeforeUnloadEvent) {
      const denyMessage = ApiUtils.createApiResponse(
        requestId,
        false,
        RPC_ERRORS.USER_REJECTED_REQUEST,
      );
      await ApiExtensionUtils.sendMessage(requestId, denyMessage);
    }

    window.addEventListener("beforeunload", beforeunload);

    return () => {
      window.removeEventListener("beforeunload", beforeunload);
    };
  }, [requestId]);

  const loading = !wallet;
  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && <HotWalletSignTransaction />}
      {!loading && wallet.type === "ledger" && <>Not Supported</>}
    </div>
  );
}
