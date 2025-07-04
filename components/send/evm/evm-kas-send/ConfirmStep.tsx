import { useFormContext } from "react-hook-form";
import { EvmKasSendForm } from "./EvmKasSend";
import React, { useState } from "react";
import signImage from "@/assets/images/sign.png";
import ledgerSignImage from "@/assets/images/ledger-on-sign.svg";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface.ts";
import { captureException } from "@sentry/react";
import { twMerge } from "tailwind-merge";
import { formatCurrency } from "@/lib/utils.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useFeeEstimate from "@/hooks/evm/useFeeEstimate";
import useAnalytics from "@/hooks/useAnalytics.ts";
import { formatEther, parseEther, TransactionSerializable } from "viem";
import { ALL_SUPPORTED_EVM_L2_CHAINS, getChainName } from "@/lib/layer2";
import { createPublicClient, http, hexToNumber } from "viem";
import { formatToken } from "@/lib/utils.ts";

export const ConfirmStep = ({
  chainId,
  onNext,
  onBack,
  onFail,
  setOutTxs,
  walletSigner: signer,
}: {
  chainId: `0x${string}`;
  onNext: () => void;
  onBack: () => void;
  onFail: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  walletSigner?: IWallet;
}) => {
  const navigate = useNavigate();
  const evmAddress = useEvmAddress();

  const { emitFirstTransaction } = useAnalytics();
  const [isSigning, setIsSigning] = useState(false);

  const { wallet } = useWalletManager();
  const { watch } = useFormContext<EvmKasSendForm>();
  const { address: toAddress, amount } = watch();

  const payload =
    evmAddress && toAddress && amount
      ? {
          account: evmAddress,
          to: toAddress as `0x${string}`,
          value: parseEther(amount),
        }
      : undefined;
  const { data: estimatedFee } = useFeeEstimate(chainId, payload);

  const kaspaPrice = useKaspaPrice();
  const amountNumber = parseFloat(amount ?? "0");
  const fiatAmount = amountNumber * kaspaPrice.kaspaPrice;
  const fiatFees = parseFloat(formatEther(estimatedFee ?? BigInt(0)));
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(fiatAmount);
  const { amount: feesCurrency, code: feesCurrencyCode } =
    useCurrencyValue(fiatFees);

  const selectedChain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (chain) => chain.id === hexToNumber(chainId),
  );

  const ethClient = createPublicClient({
    chain: selectedChain,
    transport: http(),
  });

  const onClose = () => {
    navigate("/dashboard");
  };

  const onConfirm = async () => {
    if (isSigning || !amount || !payload || !signer) {
      return;
    }

    try {
      setIsSigning(true);

      const fromAddress = await signer.getAddress();
      const estimatedGas = await ethClient.estimateFeesPerGas();
      const gas = await ethClient.estimateGas({
        account: fromAddress,
        to: payload.to,
        value: payload.value,
      });

      const nonce = await ethClient.getTransactionCount({
        address: fromAddress,
      });

      const transaction: TransactionSerializable = {
        to: payload.to,
        value: payload.value,
        gas,
        maxFeePerGas: estimatedGas.maxFeePerGas,
        maxPriorityFeePerGas: estimatedGas.maxPriorityFeePerGas,
        chainId: hexToNumber(chainId),
        type: "eip1559",
        nonce,
      };
      const signed = await signer.signTransaction(transaction);
      const txId = await ethClient.sendRawTransaction({
        serializedTransaction: signed,
      });

      setOutTxs([txId]);
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

      <div className="flex h-full flex-col gap-2">
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

        {/* Sender */}
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Send from</span>
            <span className="border-1 rounded-full border border-icy-blue-400 px-1 text-[0.625rem] font-medium text-icy-blue-400">
              {getChainName(chainId).replace(" Testnet", "")}
            </span>
          </div>
          <span className="break-all text-xs text-daintree-400">
            {evmAddress}
          </span>
        </div>

        {/* Recipient */}
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Send to</span>
            <span className="border-1 rounded-full border border-icy-blue-400 px-1 text-[0.625rem] font-medium text-icy-blue-400">
              {getChainName(chainId).replace(" Testnet", "")}
            </span>
          </div>
          <span className="break-all text-xs text-daintree-400">
            {toAddress}
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
                <span className="font-medium">{formatToken(fiatFees)} KAS</span>
                <span className="text-xs text-daintree-400">
                  {formatCurrency(feesCurrency, feesCurrencyCode)}
                </span>
              </div>
            </div>
          </li>
        </ul>

        <div className="mt-auto">
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
