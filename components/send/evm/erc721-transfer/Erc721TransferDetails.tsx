import Header from "@/components/GeneralHeader.tsx";
import useErc721Info from "@/hooks/evm/useErc721Info";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import {
  Address,
  Hex,
  isAddress,
  encodeFunctionData,
  erc721Abi,
  formatEther,
} from "viem";
import { Erc721TransferFormData } from "../../../screens/Erc721Transfer";
import { useFormContext } from "react-hook-form";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import FeeSegment from "../../../nft-transfer/FeeSegment";
import { useNavigate } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import spinner from "@/assets/images/spinner.svg";
import { twMerge } from "tailwind-merge";
import useFeeEstimate from "@/hooks/evm/useFeeEstimate";
import placeholderImage from "@/assets/images/nft-placeholder.png";

type Erc721TransferDetailsProps = {
  chainId: Hex;
  contractAddress: Address;
  tokenId: string;
  onNext: () => void;
  onBack: () => void;
};

export default function Erc721TransferDetails({
  chainId,
  contractAddress,
  tokenId,
  onNext,
  onBack,
}: Erc721TransferDetailsProps) {
  const navigate = useNavigate();
  const sender = useEvmAddress();
  const {
    register,
    watch,
    setValue,
    formState: { isValid, errors, validatingFields },
  } = useFormContext<Erc721TransferFormData>();
  const { userInput, address } = watch();

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

  const { data: kasBalanceData } = useEvmKasBalance(chainId) ?? 0;
  const currentBalance = kasBalanceData?.rawBalance ?? 0n;

  const onClose = () => navigate("/dashboard");

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address";
    if (!value) return false;

    if (estimatedFee && currentBalance < estimatedFee) {
      return "Oh, you don’t have enough funds";
    }

    if (value === sender) {
      return "You cannot send NFT to yourself";
    }

    const isValidKaspaAddress = () => {
      const isValid = isAddress(value);

      setValue("address", isValid ? value : undefined);
      return isValid;
    };

    try {
      return isValidKaspaAddress() || genericErrorMessage;
    } catch (error) {
      console.error(error);
      return genericErrorMessage;
    }
  };

  // Handle empty user input logic
  useEffect(() => {
    if (userInput === "") {
      setValue("address", undefined, { shouldValidate: true });
    }
  }, [userInput]);

  return (
    <>
      <Header title="Transfer" onClose={onClose} onBack={onBack} />

      <div className="relative flex h-full flex-col gap-4">
        <div className="relative mx-auto max-h-28 max-w-48 rounded-xl bg-daintree-800">
          {!!data && (
            <img
              src={data.image_url ?? placeholderImage}
              alt={data.metadata?.name ?? "ERC721"}
              className="m-auto max-h-28 max-w-48 rounded-xl"
            />
          )}
        </div>
        <div className="flex items-center justify-between">
          <label className="flex gap-1 text-base font-medium">
            <span>Transfer</span>
            <span className="text-icy-blue-400">
              {data?.metadata?.name ?? "Empty Name"}
            </span>
            <span>from</span>
          </label>
        </div>
        <div>
          <textarea
            disabled
            className="no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm text-daintree-400 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0"
            value={sender}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-base font-medium">To ...</label>
          <i
            className="hn hn-lightbulb break-all text-[16px]"
            data-tooltip-id="info-tooltip"
          ></i>
          <Tooltip
            id="info-tooltip"
            style={{
              backgroundColor: "#203C49",
              fontSize: "12px",
              fontWeight: 600,
              padding: "2px 8px",
            }}
            opacity={1}
            className="flex flex-col items-center"
          >
            <span>Check the address carefully.</span>
            <span>Transactions are irreversible, and</span>
            <span>mistakes can cause asset loss.</span>
          </Tooltip>
        </div>

        {/* Address input group */}
        <div>
          <textarea
            {...register("userInput", {
              validate: addressValidator,
            })}
            className={twMerge(
              "no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0",
              errors.userInput &&
                "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
            )}
            placeholder="Enter wallet address"
          />

          <div className="pointer-events-none absolute end-0 top-10 flex h-16 items-center pe-3">
            {validatingFields.address && (
              <img
                alt="spinner"
                className="size-5 animate-spin"
                src={spinner}
              />
            )}
          </div>
          {errors.userInput && (
            <span className="inline-block text-sm text-red-500">
              {errors.userInput.message}
            </span>
          )}
        </div>

        <FeeSegment
          feeTooltipText="Fees are handled automatically by Kastle."
          estimatedFeeTooltipText={`${feeInKas} KAS for miner fees.`}
          estimatedFee={feeInKas}
        />

        <div className="mt-auto">
          <button
            disabled={!isValid}
            onClick={onNext}
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
