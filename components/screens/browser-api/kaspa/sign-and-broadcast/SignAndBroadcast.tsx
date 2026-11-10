import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { ApiUtils } from "@/api/background/utils";
import useAnalytics from "@/hooks/useAnalytics";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import { applyP2SHFeeAdjustment } from "@/lib/p2sh-fee";
import {
  hasPartialOutputCommitment,
  hasScriptOptions,
} from "@/lib/wallet/sign-script.ts";
import { PARTIAL_OUTPUT_WARNING } from "@/components/screens/browser-api/kaspa/sign-tx/SignTx";

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

  const { transaction, displayPayload, feeAdjusted } = useMemo(() => {
    const tx = deserializeTransaction(payload.txJson);
    const adjusted = account
      ? applyP2SHFeeAdjustment(tx, payload.scripts, account.address)
      : false;
    return {
      transaction: tx,
      displayPayload: { ...payload, txJson: tx.serializeToSafeJSON() },
      feeAdjusted: adjusted,
    };
  }, [payload.txJson, payload.scripts, account?.address]);

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account) {
      return;
    }

    try {
      // The Ledger signer refuses any truthy `scripts` value, so the schema's
      // empty default must reach it as undefined (script-free signing).
      const signedTx = await wallet.signTx(
        transaction,
        hasScriptOptions(payload.scripts) ? payload.scripts : undefined,
      );

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
      payload={displayPayload}
      cancel={handleCancel}
      confirm={handleConfirm}
      warning={
        [
          hasPartialOutputCommitment(payload.scripts)
            ? PARTIAL_OUTPUT_WARNING
            : undefined,
          feeAdjusted
            ? "Transaction fee was insufficient. Network fee has been automatically adjusted."
            : undefined,
        ]
          .filter(Boolean)
          .join("\n\n") || undefined
      }
    />
  );
}
