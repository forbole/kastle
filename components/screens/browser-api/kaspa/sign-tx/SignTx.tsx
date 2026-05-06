import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { ApiUtils } from "@/api/background/utils";
import useAnalytics from "@/hooks/useAnalytics";

type SignTxProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

export default function SignTx({
  wallet,
  requestId,
  payload,
  origin,
}: SignTxProps) {
  const { rpcClient } = useRpcClientStateful();
  const { emitKasSignTx } = useAnalytics();

  const handleConfirm = async () => {
    if (!rpcClient || !wallet) {
      return;
    }

    try {
      const tx = Transaction.deserializeFromSafeJSON(payload.txJson);
      const signed = await wallet.signTx(tx, payload.scripts);
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, signed.serializeToSafeJSON()),
      );
      emitKasSignTx({ origin, status: "success" });
    } catch (err) {
      emitKasSignTx({ origin, status: "failed" });
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(
          requestId,
          null,
          "Failed to sign transaction: " + (err as any).toString(),
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
    <>
      <SignConfirm
        confirm={handleConfirm}
        cancel={handleCancel}
        payload={payload}
      />
    </>
  );
}
