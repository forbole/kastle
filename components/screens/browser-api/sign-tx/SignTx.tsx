import { ApiResponse, SignTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { IWallet } from "@/lib/wallet/interface";
import { useBoolean } from "usehooks-ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";

type SignTxProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
};

export default function SignTx({ wallet, requestId, payload }: SignTxProps) {
  const { value: isLoading, toggle: toggleLoading } = useBoolean(false);
  const { rpcClient, networkId } = useRpcClientStateful();
  const { account } = useWalletManager();

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account || !networkId) {
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
    <div className="p2 text-white">
      <h1>SignAndBroadcastTxConfirm</h1>
      {payload.networkId !== networkId && (
        <>
          <span>
            Network Id does not match, please switch network to{" "}
            {payload.networkId}
          </span>
          <button
            className="rounded bg-red-500 px-4 py-2"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </>
      )}
      {payload.networkId === networkId && (
        <>
          <span>{payload.networkId}</span>
          <span>{payload.txJson}</span>
          {/* Scripts */}
          <div>
            Scripts:
            {payload.scripts?.map((script, index) => (
              <div key={index} className="border">
                <div>Input Index: {script.inputIndex}</div>
                <div>Script: {script.scriptHex}</div>
                <div>Sign Type: {script.signType ?? "All"}</div>
              </div>
            ))}
          </div>
          {isLoading && <div>Loading...</div>}
          {!isLoading && (
            <>
              <button
                className="rounded bg-red-500 px-4 py-2"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                className="rounded bg-blue-500 px-4 py-2"
                onClick={handleConfirm}
              >
                Confirm
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
