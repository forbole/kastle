import { useFormContext } from "react-hook-form";
import { KasSendForm } from "@/components/send/kas-send/KasSend";
import React, { useState } from "react";
import signImage from "@/assets/images/sign.png";
import ledgerSignImage from "@/assets/images/ledger-on-sign.svg";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { IWalletWithGetAddress } from "@/lib/wallet/wallet-interface";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import { captureException } from "@sentry/react";
import { kaspaToSompi, sompiToKaspaString } from "@/wasm/core/kaspa";
import { twMerge } from "tailwind-merge";
import { formatCurrency } from "@/lib/utils.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { createTransactions } from "@/wasm/core/kaspa";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

export const ConfirmStep = ({
  onNext,
  onBack,
  onFail,
  setOutTxs,
  walletSigner: signer,
}: {
  onNext: () => void;
  onBack: () => void;
  onFail: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  walletSigner?: IWalletWithGetAddress;
}) => {
  const navigate = useNavigate();

  const { emitFirstTransaction } = useAnalytics();
  const { addRecentAddress } = useRecentAddresses();
  const [isSigning, setIsSigning] = useState(false);
  const { rpcClient, networkId } = useRpcClientStateful();

  const { wallet, account } = useWalletManager();
  const { watch } = useFormContext<KasSendForm>();
  const { address, amount, domain, priorityFee } = watch();
  const kaspaPrice = useKaspaPrice();
  const amountNumber = parseFloat(amount ?? "0");
  const priorityFeeKas = sompiToKaspaString(priorityFee);
  const fiatAmount = amountNumber * kaspaPrice.kaspaPrice;
  const fiatFees = parseFloat(priorityFeeKas);
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(fiatAmount);
  const { amount: feesCurrency, code: feesCurrencyCode } =
    useCurrencyValue(fiatFees);

  const onClose = () => {
    navigate("/dashboard");
  };

  const onConfirm = async () => {
    if (
      isSigning ||
      !amount ||
      !address ||
      !signer ||
      !rpcClient ||
      !account ||
      !networkId
    ) {
      return;
    }

    try {
      setIsSigning(true);

      const { entries } = await rpcClient.getUtxosByAddresses([
        account.address,
      ]);

      const { transactions } = await createTransactions({
        entries: entries,
        outputs: [
          {
            address,
            amount: kaspaToSompi(amount) ?? BigInt(0),
          },
        ],
        priorityFee: 0n,
        changeAddress: await signer.getAddress(),
        networkId: networkId,
      });
      const transaction = transactions[0].transaction;
      const signedTransaction = await signer.signTx(transaction);
      const { transactionId } = await rpcClient.submitTransaction({
        transaction: signedTransaction,
      });

      await addRecentAddress({
        usedAt: Date.now(),
        kaspaAddress: address,
        domain,
      });

      setOutTxs([transactionId]);
      // Don't await, analytics should not crash the app
      emitFirstTransaction({
        amount,
        coin: "KAS",
        direction: "send",
      });

      onNext();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <>
      <Header title="Confirm" onClose={onClose} onBack={onBack} />

      <div className="flex min-h-0 flex-col gap-2">
        {wallet?.type === "ledger" && (
          <img
            alt="ledger-on-confirm"
            className="self-center"
            src={ledgerSignImage}
          />
        )}
        {wallet?.type !== "ledger" && (
          <img
            alt="castle"
            className="h-[120px] w-[134px] self-center"
            src={signImage}
          />
        )}

        <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-scroll pr-1">
          {/* Sender */}
          <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Send from</span>
              <span className="border-1 rounded-full border border-icy-blue-400 px-1 text-[0.625rem] font-medium text-icy-blue-400">
                Kaspa
              </span>
            </div>
            <span className="break-all text-xs text-daintree-400">
              {account?.address}
            </span>
          </div>

          {/* Recipient */}
          <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Send to
                <a className="text-icy-blue-400">{!!domain && ` ${domain}`}</a>
              </span>
              <span className="border-1 rounded-full border border-icy-blue-400 px-1 text-[0.625rem] font-medium text-icy-blue-400">
                Kaspa
              </span>
            </div>
            <span className="break-all text-xs text-daintree-400">
              {address}
            </span>
          </div>

          <ul className="flex flex-col rounded-lg bg-daintree-800">
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Sending amount</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">
                    {amountNumber.toFixed(3)} KAS
                  </span>
                  <span className="text-xs text-daintree-400">
                    {formatCurrency(amountCurrency, amountCurrencyCode)}
                  </span>
                </div>
              </div>
            </li>
            <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
              <div className="flex w-full items-start justify-between">
                <span className="font-medium">Fee</span>
                <div className="flex flex-col text-right">
                  <span className="font-medium">{priorityFeeKas} KAS</span>
                  <span className="text-xs text-daintree-400">
                    {formatCurrency(feesCurrency, feesCurrencyCode)}
                  </span>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <div className="mt-4">
          <button
            onClick={onConfirm}
            className={twMerge(
              "mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors",
              !isSigning && "hover:bg-icy-blue-600",
            )}
            disabled={isSigning}
          >
            {isSigning ? (
              <div className="flex gap-2">
                <div
                  className="inline-block size-5 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                  role="status"
                  aria-label="loading"
                />
                {wallet?.type === "ledger" && (
                  <span>Please approve on Ledger</span>
                )}
              </div>
            ) : (
              "Next"
            )}
          </button>
        </div>
      </div>
    </>
  );
};
