import { ApiResponse, SignTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { useBoolean } from "usehooks-ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import {
  Transaction,
  sompiToKaspaString,
  Address,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { useState } from "react";
import Header from "@/components/GeneralHeader";
import signImage from "@/assets/images/sign.png";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import TransactionDetails from "@/components/screens/browser-api/sign-and-broadcast/TransactionDetails";

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
  const kapsaPrice = useKaspaPrice();
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();
  const [hideDetails, setHideDetails] = useState(true);

  const transaction = Transaction.deserializeFromSafeJSON(payload.txJson);

  const inputsAmount = transaction.inputs.reduce(
    (acc, input) => acc + BigInt(input.utxo?.amount || 0),
    BigInt(0),
  );
  const outputsAmount = transaction.outputs.reduce(
    (acc, output) => acc + BigInt(output.value),
    BigInt(0),
  );

  // Calculate sending amount
  const sendingAmount = transaction.outputs
    .filter((output) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript !== output.scriptPublicKey.toString();
    })
    .reduce((acc, output) => acc + output.value, BigInt(0));

  const sendingAmountInKas = sompiToKaspaString(sendingAmount);

  // Calculate fees
  const fees = sompiToKaspaString(inputsAmount - outputsAmount);

  const remaining =
    parseFloat(account?.balance ?? "0") -
    parseFloat(fees) -
    parseFloat(sendingAmountInKas);

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
    <div className="p-4">
      <Header showPrevious={false} onClose={handleCancel} title="Confirm" />
      {payload.networkId !== networkId && (
        <div>
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
        </div>
      )}
      {payload.networkId === networkId && (
        <div>
          <img src={signImage} alt="Sign" className="mx-auto" />
          <span>{payload.networkId}</span>

          <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Your new balance will be</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{remaining} KAS</span>
                  <span className="text-xs text-daintree-400">
                    {remaining * kapsaPrice.kaspaPrice} USD
                  </span>
                </div>
              </div>
            </li>
          </ul>

          {/* Result */}
          <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Sending amount</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{sendingAmountInKas} KAS</span>
                  <span className="text-xs text-daintree-400">
                    {parseFloat(sendingAmountInKas) * kapsaPrice.kaspaPrice} USD
                  </span>
                </div>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Fee</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{fees} KAS</span>
                  <span className="text-xs text-daintree-400">
                    {parseFloat(fees) * kapsaPrice.kaspaPrice} USD
                  </span>
                </div>
              </div>
            </li>
          </ul>

          <div className="space-y-4 py-4">
            <span
              className="inline-flex cursor-pointer items-center gap-2 font-semibold text-[#00B1D0]"
              onClick={() => setHideDetails(!hideDetails)}
            >
              Show raw transaction details
              {hideDetails ? (
                <i className="hn hn-chevron-down h-[14px] w-[14px]" />
              ) : (
                <i className="hn hn-chevron-up h-[14px] w-[14px]" />
              )}
            </span>

            {!hideDetails && <TransactionDetails payload={payload} />}
          </div>

          {/* Buttons */}
          <div>
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
          </div>
        </div>
      )}
    </div>
  );
}
