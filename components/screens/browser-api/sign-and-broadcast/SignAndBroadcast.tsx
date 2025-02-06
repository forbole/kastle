import { ApiResponse, SignAndBroadcastTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { IWallet } from "@/lib/wallet/interface";
import { useBoolean } from "usehooks-ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

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

  const transactionEstimate = useTransactionEstimate({
    account,
    outputs: payload.outputs,
  });

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account) {
      return;
    }

    try {
      toggleLoading();
      const txId = await wallet.signAndBroadcastTx(
        payload.outputs,
        payload.options,
      );
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
          {/* Entries */}
          {payload.options?.entries && (
            <div className="border">
              Inputs:
              <div>
                {payload.options?.entries.map((input, index) => (
                  <div key={index}>
                    <div>Sender: {input.address}</div>
                    <div>Amount: {input.amount}</div>
                    <div>Script: {input.scriptPublicKey.script}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Priority Entries */}
          {payload.options?.priorityEntries && (
            <div className="border">
              Priority Inputs:
              <div>
                {payload.options?.priorityEntries.map((input, index) => (
                  <div key={index}>
                    <div>Sender: {input.address}</div>
                    <div>Amount: {input.amount}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outputs */}
          <div className="border">
            Outputs:
            <div>
              {payload.outputs.map((output, index) => (
                <div key={index}>
                  <div>Receiver: {output.address}</div>
                  <div>Amount: {output.amount}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Scripts */}
          <div>
            Scripts:
            {payload.options?.scripts?.map((script, index) => (
              <div key={index} className="border">
                <div>Input Index: {script.inputIndex}</div>
                <div>Script: {script.scriptHex}</div>
                <div>Sign Type: {script.signType}</div>
              </div>
            ))}
          </div>

          {/* Payload */}
          <div>
            Payload:
            {payload.options?.payload
              ? Buffer.from(payload.options.payload).toString("hex")
              : ""}
          </div>
          <div>Fees: {transactionEstimate?.totalFees}</div>
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
