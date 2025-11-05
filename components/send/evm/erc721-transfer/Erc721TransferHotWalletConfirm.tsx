import Header from "@/components/GeneralHeader";
import { Erc721TransferFormData } from "@/components/screens/Erc721Transfer";
import { useNavigate } from "react-router-dom";
import { useFormContext } from "react-hook-form";
import { Address, formatEther, Hex } from "viem";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import { encodeFunctionData, erc721Abi, isAddress } from "viem";
import useFeeEstimate from "@/hooks/evm/useFeeEstimate";
import signImage from "@/assets/images/sign.png";
import useErc721Info from "@/hooks/evm/useErc721Info";
import { formatCurrency, textEllipsis } from "@/lib/utils";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import { useState } from "react";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import {
  createPublicClient,
  http,
  hexToNumber,
  TransactionSerializable,
} from "viem";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";

type Erc721TransferHotWalletConfirmProps = {
  chainId: Hex;
  contractAddress: Address;
  tokenId: string;
  setOutTxs: (txs: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  onFail: () => void;
};

export default function Erc721TransferHotWalletConfirm({
  chainId,
  contractAddress,
  tokenId,
  setOutTxs,
  onNext,
  onBack,
  onFail,
}: Erc721TransferHotWalletConfirmProps) {
  const navigate = useNavigate();
  const sender = useEvmAddress();
  const signer = useEvmHotWalletSigner();
  const [isSigning, setIsSigning] = useState(false);

  const onClose = () => {
    navigate("/dashboard");
  };
  const { watch } = useFormContext<Erc721TransferFormData>();
  const { address } = watch();
  const { data } = useErc721Info(chainId, contractAddress, tokenId);
  const payload =
    address && isAddress(address ?? "") && sender
      ? {
          account: sender,
          to: contractAddress,
          data: encodeFunctionData({
            abi: erc721Abi,
            functionName: "safeTransferFrom",
            args: [sender, address as Address, BigInt(tokenId)],
          }),
        }
      : undefined;

  const { data: estimatedFee } = useFeeEstimate(chainId, payload);
  const feeInKas = formatEther(estimatedFee ?? 0n);
  const kaspaPrice = useKaspaPrice().kaspaPrice;
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    estimatedFee ? parseFloat(feeInKas) * kaspaPrice : 0,
  );

  const selectedChain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (chain) => chain.id === hexToNumber(chainId),
  );

  const ethClient = createPublicClient({
    chain: selectedChain,
    transport: http(),
  });
  const onConfirm = async () => {
    if (isSigning || !payload || !sender || !signer) return;
    setIsSigning(true);

    try {
      const estimatedGas = await ethClient.estimateFeesPerGas();
      const gas = await ethClient.estimateGas({
        account: sender,
        to: payload.to,
        data: payload.data,
      });

      const nonce = await ethClient.getTransactionCount({
        address: sender,
      });
      const transaction: TransactionSerializable = {
        to: payload.to,
        data: payload.data,
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
      onNext();
    } catch (error) {
      onFail();
    } finally {
      setIsSigning(false);
    }
  };

  const showName = textEllipsis(data?.metadata?.name ?? "Empty Name", 15);

  return (
    <>
      <Header title="Confirm" onClose={onClose} onBack={onBack} />

      <div className="flex h-full flex-col gap-2">
        <img
          alt="castle"
          className="h-[120px] w-[134px] self-center"
          src={signImage}
        />

        {/* Recipient */}
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <div className="flex gap-1 text-base font-medium">
            <span>Transfer</span>
            <span className="text-icy-blue-400">{showName}</span>
            <span>from</span>
          </div>
          <span className="break-all text-xs text-daintree-400">{sender}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">To</span>
          <span className="break-all text-xs text-daintree-400">{address}</span>
        </div>
        <div className="flex justify-between gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">Fee</span>
          <div className="flex flex-col items-end break-all">
            <span className="text-base font-medium text-white">
              {feeInKas} KAS
            </span>
            <span className="text-xs text-daintree-400">
              {formatCurrency(feesCurrency, feesCurrencyCode)}
            </span>
          </div>
        </div>

        <div className="mt-auto">
          <button
            onClick={onConfirm}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
}
