import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { ApiUtils } from "@/api/background/utils";
import useAnalytics from "@/hooks/useAnalytics";
import { deserializeTransaction } from "@/lib/kaspa-compat";

type SignAndBroadcastProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

export default function SignAndBroadcast({
  wallet,
  requestId,
  payload,
  origin,
}: SignAndBroadcastProps) {
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();
  const { emitKasSignAndBroadcastTx } = useAnalytics();

  const transaction = deserializeTransaction(payload.txJson);

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account) {
      return;
    }

    try {
      const signedTx = await wallet.signTx(transaction, payload.scripts);

      const MAX_RETRIES = 5;
      let txId: string | undefined;
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
        try {
          const result = await rpcClient.submitTransaction({
            transaction: signedTx,
          });
          txId = result.transactionId;
          lastError = undefined;
          break;
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.toLowerCase().includes("orphan")
          ) {
            lastError = e;
            continue;
          }
          throw e;
        }
      }
      if (lastError) throw lastError;

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, txId),
      );
      emitKasSignAndBroadcastTx({ origin, status: "success" });
    } catch (err) {
      emitKasSignAndBroadcastTx({ origin, status: "failed" });
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(
          requestId,
          null,
          "Failed to sign and broadcast transaction: " +
            (err as any).toString(),
        ),
      );
    } finally {
      window.close();
    }
  };

  const handleCancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, null, "User denied"),
    );
    window.close();
  };

  return (
    <SignConfirm
      payload={payload}
      cancel={handleCancel}
      confirm={handleConfirm}
    />
  );
}
