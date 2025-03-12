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
  payload: SignTxPayload;
  confirm: () => void;
  cancel: () => void;
};

export default function SignConfirm({
  payload,
  confirm,
  cancel,
}: SignConfirmProps) {
  const kapsaPrice = useKaspaPrice();
  const { account } = useWalletManager();
  const [hideDetails, setHideDetails] = useState(true);

  const transaction = Transaction.deserializeFromSafeJSON(payload.txJson);

  const inputsAmount = transaction.inputs.reduce(
    (acc, input) => acc + (input.utxo?.amount ?? 0n),
    0n,
  );
  const outputsAmount = transaction.outputs.reduce(
    (acc, output) => acc + output.value,
    0n,
  );

  // Calculate sending amount in output
  const sendingAmount = transaction.outputs
    .filter((output) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript !== output.scriptPublicKey.toString();
    })
    .reduce((acc, output) => acc + output.value, 0n);

  const sendingAmountInKas = sompiToKaspaString(sendingAmount);

  // Calculate fees
  let feesInKas = "0";
  // If inputsAmount is greater than outputsAmount, then we don't need to calculate fees because it would be a incomplete transaction
  if (inputsAmount > outputsAmount) {
    feesInKas = sompiToKaspaString(inputsAmount - outputsAmount);
  }

  // Calculate user sending amount for current user
  const userSending = transaction.inputs
    .filter((input) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript === input.utxo?.scriptPublicKey.toString();
    })
    .reduce((acc, input) => acc + (input.utxo?.amount ?? 0n), 0n);

  // Calculate receiving amount for current user
  const userReceiving = transaction.outputs
    .filter((output) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript === output.scriptPublicKey.toString();
    })
    .reduce((acc, output) => acc + output.value, 0n);

  // Calculate difference, note that sompToKaspaString only works with positive numbers
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const difference = userReceiving - userSending;
  let differenceInKas = parseFloat(sompiToKaspaString(abs(difference)));
  if (difference < 0n) {
    differenceInKas = -differenceInKas;
  }

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
  const selectedNetwork = networks.find((n) => n.id === payload.networkId);

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <Header showPrevious={false} showClose={false} title="Confirm" />
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
              <span className="font-medium">Change to your balance</span>
              <div
                className={twMerge(
                  "flex flex-col text-right",
                  differenceInKas >= 0 ? "text-teal-500" : "text-red-500",
                )}
              >
                <span className="font-medium">
                  {differenceInKas >= 0 && "+"}
                  {differenceInKas} KAS
                </span>
                <span className="text-xs text-daintree-400">
                  {differenceInKas * kapsaPrice.kaspaPrice} USD
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
                <span className="font-medium">{feesInKas} KAS</span>
                <span className="text-xs text-daintree-400">
                  {parseFloat(feesInKas) * kapsaPrice.kaspaPrice} USD
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
      <div
        className={twMerge(
          "flex gap-2 text-base font-semibold",
          !hideDetails && "pb-4",
        )}
      >
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
