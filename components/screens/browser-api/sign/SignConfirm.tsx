import { SignTxPayload } from "@/api/message";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import useWalletManager from "@/hooks/useWalletManager";
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
import DetailsSelector from "@/components/screens/browser-api/sign/DetailsSelector";
import { twMerge } from "tailwind-merge";

type SignConfirmProps = {
  networkId: NetworkType;
  payload: SignTxPayload;
  confirm: () => void;
  cancel: () => void;
};

export default function SignConfirm({
  networkId,
  payload,
  confirm,
  cancel,
}: SignConfirmProps) {
  const kapsaPrice = useKaspaPrice();
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

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      background: "bg-teal-800",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet | T10",
      text: "text-yellow-500",
      background: "bg-yellow-800",
    },
    {
      id: NetworkType.TestnetT11,
      name: "Testnet | T11",
      text: "text-violet-500",
      background: "bg-violet-800",
    },
  ];
  const selectedNetwork = networks.find((n) => n.id === networkId);

  return (
    <div className="flex h-screen flex-col justify-between p-4">
      <div>
        <Header showPrevious={false} onClose={cancel} title="Confirm" />
        <div className="relative">
          <img src={signImage} alt="Sign" className="mx-auto" />
          <div
            className={twMerge(
              "absolute right-0 top-0 flex items-center gap-1 rounded-full px-2",
              selectedNetwork?.text,
              selectedNetwork?.background,
            )}
          >
            <i className="hn hn-globe-solid" />
            {selectedNetwork?.name}
          </div>
        </div>

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

          {!hideDetails && <DetailsSelector payload={payload} />}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 text-base font-semibold">
        <button className="rounded-full p-5 text-[#7B9AAA]" onClick={cancel}>
          Cancel
        </button>
        <button
          className="flex-auto rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
          onClick={confirm}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
