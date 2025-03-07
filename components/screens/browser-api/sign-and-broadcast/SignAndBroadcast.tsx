import { ApiResponse, SignAndBroadcastTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { useBoolean } from "usehooks-ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction, sompiToKaspaString } from "@/wasm/core/kaspa";

type SignAndBroadcastProps = {
  wallet: IWallet;
  networkId: NetworkType;
  requestId: string;
  payload: SignAndBroadcastTxPayload;
};

export default function SignAndBroadcast({
  wallet,
  networkId,
  requestId,
  payload,
}: SignAndBroadcastProps) {
  const { value: isLoading, toggle: toggleLoading } = useBoolean(false);
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();

  const transaction = Transaction.deserializeFromSafeJSON(payload.txJson);

  const inputsAmount = transaction.inputs.reduce(
    (acc, input) => acc + BigInt(input.utxo?.amount || 0),
    BigInt(0),
  );
  const outputsAmount = transaction.outputs.reduce(
    (acc, output) => acc + BigInt(output.value),
    BigInt(0),
  );
  const fees = sompiToKaspaString(inputsAmount - outputsAmount);

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account) {
      return;
    }

    try {
      toggleLoading();
      const signedTx = await wallet.signTx(transaction, payload.scripts);
      const { transactionId: txId } = await rpcClient.submitTransaction({
        transaction: signedTx,
      });
      toggleLoading();
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
          {/* Tx */}
          <div className="border">
            Transaction JSON:
            <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-gray-800 p-2">
              {JSON.stringify(payload.txJson, null, 2)}
            </pre>
          </div>

          {/* Scripts */}
          <div>
            Scripts:
            {payload.scripts?.map((script, index) => (
              <div key={index} className="border">
                <div>Input Index: {script.inputIndex}</div>
                <div>Script: {script.scriptHex}</div>
                <div>Sign Type: {script.signType}</div>
              </div>
            ))}
          </div>

          <div>Fees: {fees}</div>
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
