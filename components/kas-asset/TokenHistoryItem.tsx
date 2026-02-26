import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { formatCurrency, formatToken } from "@/lib/utils.ts";
import { twMerge } from "tailwind-merge";
import useAccountManager from "@/hooks/wallet/useAccountManager";
import { sompiToKaspaString } from "@/wasm/core/kaspa";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useKaspaPrice from "@/hooks/useKaspaPrice";

type TokenHistoryItemProps = {
  inputs: {
    address: string;
    amount: number;
  }[];
  outputs: {
    address: string;
    amount: number;
  }[];
  txHash: string;
};

export default function TokenHistoryItem({
  inputs,
  outputs,
  txHash,
}: TokenHistoryItemProps) {
  const { kaspaPrice } = useKaspaPrice();
  const { account } = useAccountManager();
  const inputsByAccount = inputs.filter(
    (input) => input.address === account?.address,
  );
  const outputsByAccount = outputs.filter(
    (output) => output.address === account?.address,
  );

  const totalInput = inputsByAccount.reduce(
    (acc, input) => acc + input.amount,
    0,
  );
  const totalOutput = outputsByAccount.reduce(
    (acc, output) => acc + output.amount,
    0,
  );

  const amountInSompi = Number(totalOutput) - Number(totalInput);
  const absAmountInSompi = amountInSompi < 0 ? -amountInSompi : amountInSompi;
  const kaspaAmount = sompiToKaspaString(absAmountInSompi);
  const kaspaAmountNumber = parseFloat(kaspaAmount.replace(/,/g, ''));
  const formattedAmount = formatToken(kaspaAmountNumber, 4);
  const status = amountInSompi <= 0 ? "Sent" : "Received";

  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(kaspaAmountNumber * kaspaPrice);

  const { networkId } = useRpcClientStateful();

  const network = networkId ?? NetworkType.Mainnet;
  const explorerTxLink = explorerTxLinks[network];

  const openTransaction = (transactionId: string) => {
    browser.tabs.create({
      url: `${explorerTxLink}${transactionId}`,
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
        <img
          alt="castle"
          className="h-[40px] w-[40px] rounded-full"
          src={kasIcon}
        />
        <div className="flex flex-grow flex-col gap-1">
          <div className="flex items-center justify-between text-base text-white">
            <span className="capitalize">{status}</span>
            <span
              className={twMerge(
                status === "Sent" ? "text-[#EF4444]" : "text-[#14B8A6]",
              )}
            >
              {status === "Sent" && "-"}
              {status === "Received" && "+"}
              {formattedAmount}
            </span>
          </div>
          <div className="hs-tooltip hs-tooltip-toggle flex items-center justify-between text-sm text-daintree-400 [--placement:bottom] [--trigger:hover]">
            <span className="flex items-center gap-2">
              TX Hash
              <span
                className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-white/10 p-3 text-xs font-medium text-white"
                onClick={() => openTransaction(txHash)}
              >
                ...
              </span>
            </span>
            <span>≈ {formatCurrency(amountCurrency, amountCurrencyCode)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
