import { ApiResponse, SignTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { useBoolean } from "usehooks-ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";
import SignConfirm from "@/components/screens/browser-api/sign/SignConfirm";
import LedgerConfirm from "@/components/screens/ledger-connect/LedgerConfirm";

type SignTxProps = {
  walletType: string;
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
};

export default function SignTx({
  walletType,
  wallet,
  requestId,
  payload,
}: SignTxProps) {
  const { value: isLoading, toggle: toggleLoading } = useBoolean(false);
  const { rpcClient } = useRpcClientStateful();

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || isLoading) {
      return;
    }

    try {
      toggleLoading();
      const tx = Transaction.deserializeFromSafeJSON(payload.txJson);
      const signed = await wallet.signTx(tx, payload.scripts);
      toggleLoading();
      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(requestId, signed.serializeToSafeJSON()),
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
    <>
      {isLoading && walletType === "ledger" && (
        <LedgerConfirm showClose={false} showPrevious={false} />
      )}
      {!isLoading && walletType != "ledger" && (
        <SignConfirm
          confirm={handleConfirm}
          cancel={handleCancel}
          payload={payload}
        />
      )}
    </>
  );
}
