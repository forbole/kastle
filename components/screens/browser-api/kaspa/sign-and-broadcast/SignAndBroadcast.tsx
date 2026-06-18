import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet, ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { ApiUtils } from "@/api/background/utils";
import useAnalytics from "@/hooks/useAnalytics";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  payToAddressScript,
  Transaction,
  TransactionOutput,
} from "@/wasm/core/kaspa";
import { calcRevealInputMass } from "@/lib/kaspaFee";

type SignAndBroadcastProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

// P2SH scriptPublicKey: OP_BLAKE2B(aa) PUSH_32(20) <32B hash> OP_EQUAL(87) = 70 hex chars
function isP2SHScript(script: string): boolean {
  return (
    script.length === 70 && script.startsWith("aa20") && script.endsWith("87")
  );
}

// Adjust fee upfront for P2SH redeem script overhead the external builder may have missed.
// P2SH sig script = sig(65B) + push prefix(2B) + redeem script(NB) vs plain sig(65B).
// Fee rate: 100 per mass gram.
function applyP2SHFeeAdjustment(
  tx: Transaction,
  scripts: ScriptOption[],
  userAddress: string,
): boolean {
  const extraFee = scripts.reduce((sum, s) => {
    if (!s.scriptHex) return sum;
    const input = tx.inputs[s.inputIndex];
    if (!input) return sum;
    const script = input.utxo?.scriptPublicKey.script ?? "";
    if (!isP2SHScript(script)) return sum;
    return sum + calcRevealInputMass(s.scriptHex) * 100n;
  }, 0n);

  if (extraFee === 0n) return false;

  const expectedScript = payToAddressScript(userAddress).script;
  const outputs = tx.outputs;
  const changeIdx = outputs.findIndex(
    (o) => o.scriptPublicKey.script === expectedScript,
  );

  if (changeIdx === -1 || outputs[changeIdx].value <= extraFee) return false;

  tx.outputs = outputs.map((o, i) =>
    i === changeIdx
      ? new TransactionOutput(o.value - extraFee, o.scriptPublicKey)
      : o,
  );
  tx.finalize();
  return true;
}

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
      payload={displayPayload}
      cancel={handleCancel}
      confirm={handleConfirm}
      warning={
        feeAdjusted
          ? "Transaction fee was insufficient. Network fee has been automatically adjusted."
          : undefined
      }
    />
  );
}
