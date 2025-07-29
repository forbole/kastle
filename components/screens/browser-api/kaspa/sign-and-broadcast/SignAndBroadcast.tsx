import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { useState } from "react";
import { ApiUtils } from "@/api/background/utils";

type SignAndBroadcastProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
};

export default function SignAndBroadcast({
  wallet,
  requestId,
  payload,
}: SignAndBroadcastProps) {
  const [isBroadcasting, setBroadcasting] = useState(false);
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();

  const transaction = Transaction.deserializeFromSafeJSON(payload.txJson);

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account || isBroadcasting) {
      return;
    }

    try {
      setBroadcasting(true);
      const signedTx = await wallet.signTx(transaction, payload.scripts);
      const { transactionId: txId } = await rpcClient.submitTransaction({
        transaction: signedTx,
      });

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, txId),
      );
    } catch (err) {
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
      setBroadcasting(false);
      window.close();
    }
  };

  const handleCancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, null, "User cancelled"),
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
