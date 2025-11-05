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
import { formatCurrency } from "@/lib/utils";

type Erc721TransferConfirmProps = {
  chainId: Hex;
  contractAddress: Address;
  tokenId: string;
  onNext?: () => void;
  onBack?: () => void;
};

export default function Erc721TransferConfirm({
  chainId,
  contractAddress,
  tokenId,
  onNext,
  onBack,
}: Erc721TransferConfirmProps) {
  const navigate = useNavigate();
  const sender = useEvmAddress();
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
            args: [sender, address as Address, BigInt(parseInt(tokenId, 10))],
          }),
        }
      : undefined;

  const { data: estimatedFee } = useFeeEstimate(chainId, payload);
  const feeInKas = formatEther(estimatedFee ?? 0n);
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    estimatedFee ? parseFloat(feeInKas) * useKaspaPrice().kaspaPrice : 0,
  );

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
            <span className="text-icy-blue-400">
              {data?.metadata?.name ?? "Empty Name"}
            </span>
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
            onClick={onNext}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
}
