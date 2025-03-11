import { ApiResponse, SignTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { useBoolean } from "usehooks-ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";
import SignConfirm from "@/components/screens/browser-api/sign/SignConfirm";

type SignAndBroadcastProps = {
  wallet: IWallet;
  networkId: NetworkType;
  requestId: string;
  payload: SignTxPayload;
};

export default function SignAndBroadcast({
  wallet,
  networkId,
  requestId,
  payload,
}: SignAndBroadcastProps) {
  const { value: isBroadcasting, toggle: toggleBroadcasting } =
    useBoolean(false);
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();

  const transaction = Transaction.deserializeFromSafeJSON(payload.txJson);

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account || isBroadcasting) {
      return;
    }

    try {
      toggleBroadcasting();
      const signedTx = await wallet.signTx(transaction, payload.scripts);
      const { transactionId: txId } = await rpcClient.submitTransaction({
        transaction: signedTx,
      });
      toggleBroadcasting();
      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(requestId, txId),
      );
    } catch (err) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(
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
      new ApiResponse(requestId, null, "User cancelled"),
    );
    window.close();
  };

  return (
    <SignConfirm
      networkId={networkId}
      payload={payload}
      cancel={handleCancel}
      confirm={handleConfirm}
    />
  );
}
