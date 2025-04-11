import HotWalletSignTransaction from "@/components/screens/browser-api/ethereum/send-transaction/HotWalletSendTransaction";
import useWalletManager from "@/hooks/useWalletManager.ts";
import Splash from "@/components/screens/Splash";

export default function EthereumSendTransactionConfirm() {
  const { wallet } = useWalletManager();

  const loading = !wallet;
  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && wallet.type !== "ledger" && <HotWalletSignTransaction />}
      {!loading && wallet.type === "ledger" && <>Not Supported</>}
    </div>
  );
}
