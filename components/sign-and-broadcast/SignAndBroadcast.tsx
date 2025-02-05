import { ApiResponse, TransactionPayload } from "@/api/message";
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
  transaction: TransactionPayload;
};

export default function SignAndBroadcast({
  wallet,
  networkId,
  requestId,
  transaction,
}: SignAndBroadcastProps) {
  const { value: isLoading, toggle: toggleLoading } = useBoolean(false);
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();

  const transactionEstimate = useTransactionEstimate({
    account,
    outputs: transaction.outputs,
  });

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account) {
      return;
    }

    try {
      toggleLoading();
      const txId = await wallet.signAndBroadcastTx(
        transaction.outputs,
        transaction.options,
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
      {transaction.networkId !== networkId && (
        <>
          <span>
            Network Id does not match, please switch network to{" "}
            {transaction.networkId}
          </span>
          <button
            className="rounded bg-red-500 px-4 py-2"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </>
      )}
      {transaction.networkId === networkId && (
        <>
          <span>{transaction.networkId}</span>
          {/* Entries */}
          {transaction.options?.entries && (
            <div className="border">
              Inputs:
              <div>
                {transaction.options?.entries.map((input, index) => (
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
          {transaction.options?.priorityEntries && (
            <div className="border">
              Priority Inputs:
              <div>
                {transaction.options?.priorityEntries.map((input, index) => (
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
              {transaction.outputs.map((output, index) => (
                <div key={index}>
                  <div>Receiver: {output.address}</div>
                  <div>Amount: {output.amount}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Script */}
          <div>
            Script:
            {transaction.options?.scriptHex
              ? Buffer.from(transaction.options.scriptHex, "hex").toString()
              : ""}
          </div>

          {/* Payload */}
          <div>
            Payload:
            {transaction.options?.payload
              ? Buffer.from(transaction.options.payload).toString("hex")
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
