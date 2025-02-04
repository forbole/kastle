import { ApiResponse, TransactionPayload } from "@/api/message";
import { Buffer } from "buffer";
import { ApiExtensionUtils } from "@/api/extension";
import { useBoolean } from "usehooks-ts";
import useTransactionEstimate from "@/hooks/useTransactionEstimate";
import useCurrentAccount from "@/hooks/useWalletManager";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { IWallet, PaymentOutput } from "@/lib/wallet/interface";

export default function SignAndBroadcastTxConfirm() {
  const { value: isLoading, toggle: toggleLoading } = useBoolean(false);
  const { rpcClient, networkId } = useRpcClientStateful();
  const { getWalletSecret } = useKeyring();
  const { account } = useCurrentAccount();
  const { wallet } = useWalletManager();

  const requestId = new URLSearchParams(window.location.search).get(
    "requestId",
  );
  if (!requestId) {
    throw new Error("No request id found");
  }

  // Retrieve the transaction payload from the URL
  const base64Encoded = new URLSearchParams(window.location.search).get(
    "payload",
  );
  if (!base64Encoded) {
    throw new Error("No transaction payload found");
  }
  const transaction = TransactionPayload.fromBase64Url(base64Encoded);

  const transactionEstimate = useTransactionEstimate({
    account,
    outputs: transaction.outputs,
  });

  const handleConfirm = async () => {
    if (!rpcClient || !networkId || !wallet || !account) {
      return;
    }

    const accountFactory = new AccountFactory(rpcClient, networkId);
    try {
      const { walletSecret } = await getWalletSecret({ walletId: wallet.id });
      let signerAccount: IWallet;
      switch (walletSecret.type) {
        case "mnemonic":
          signerAccount = accountFactory.createFromMnemonic(
            walletSecret.value,
            account.index,
          );
          break;

        case "privateKey":
          signerAccount = accountFactory.createFromPrivateKey(
            walletSecret.value,
          );
          break;

        case "ledger":
          throw new Error("Ledger wallet not supported");

        default:
          throw new Error("Unsupported wallet secret type");
      }

      toggleLoading();
      const txId = await signerAccount.signAndBroadcastTx(
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
