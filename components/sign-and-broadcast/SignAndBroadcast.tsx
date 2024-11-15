import { ApiResponse, TransactionPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { IWallet } from "@/lib/wallet/interface";
import { kaspaToSompi } from "@/wasm/core/kaspa";
import { useBoolean } from "usehooks-ts";
import useWalletManager from "@/hooks/useWalletManager.ts";

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
  const { account } = useWalletManager();
  const transactionEstimate = useTransactionEstimate({
    account,
    outputs: transaction.outputs,
  });

  const handleCancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      new ApiResponse(requestId, null, "User cancelled"),
    );
    window.close();
  };

  const handleConfirm = async () => {
    try {
      toggleLoading();
      const response = await wallet.signAndBroadcastTx(
        transaction.outputs,
        kaspaToSompi(transaction.priorityFee ?? "0"),
        transaction.payload,
      );
      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(requestId, response),
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
      toggleLoading();
      window.close();
    }
  };

  return (
    <>
      {isLoading && <div>Loading...</div>}
      {!isLoading && (
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
              <div>
                Payload:{" "}
                {transaction.payload
                  ? Buffer.from(transaction.payload).toString("hex")
                  : ""}
              </div>
              <div>Fees: {transactionEstimate?.totalFees}</div>
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
        </div>
      )}
    </>
  );
}
