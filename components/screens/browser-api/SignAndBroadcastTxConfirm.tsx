import { TransactionPayload } from "@/api/message";
import HotWalletSignAndBroadcast from "@/components/sign-and-broadcast/HotWalletSignAndBroadcast";
import LedgerSignAndBroadcast from "@/components/sign-and-broadcast/LedgerSignAndBroadcast";
import useWalletManager from "@/hooks/useWalletManager.ts";

export default function SignAndBroadcastTxConfirm() {
  const { wallet } = useWalletManager();
  const requestId = new URLSearchParams(window.location.search).get(
    "requestId",
  );
  if (!requestId) {
    throw new Error("No request id found");
  }

  // Retrieve the transaction payload from the URL
  const base64Encoded = new URLSearchParams(window.location.search).get(
    "payload",
  );
  if (!base64Encoded) {
    throw new Error("No transaction payload found");
  }
  const transaction = TransactionPayload.fromBase64Url(base64Encoded);

  return (
    <>
      {!wallet && <>Loading</>}
      {wallet && wallet.type !== "ledger" ? (
        <HotWalletSignAndBroadcast
          requestId={requestId}
          transaction={transaction}
        />
      ) : (
        <LedgerSignAndBroadcast />
      )}
    </>
  );
}
