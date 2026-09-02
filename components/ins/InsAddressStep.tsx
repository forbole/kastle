import { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { Hex, isAddress } from "viem";
import { twMerge } from "tailwind-merge";
import Header from "@/components/GeneralHeader";
import FeeSegment from "@/components/nft-transfer/FeeSegment";

export interface InsAddressFormData {
  userInput: string | undefined;
  address: Hex | undefined;
}

type InsAddressStepProps = {
  title: string;
  /** Explains what this address is about to be used for. Sits above the input. */
  intro: ReactNode;
  inputLabel: string;
  placeholder?: string;
  /** Formatted KAS, already estimated by the caller for its own payload. */
  feeInKas: string;
  nextLabel?: string;
  /** Screen-specific rejection, e.g. transferring a name to yourself. */
  extraValidate?: (address: Hex) => string | undefined;
  onNext: () => void;
  onBack: () => void;
};

/**
 * Address entry shared by the set-target and transfer flows. Both take exactly
 * one EVM address and differ only in copy and in what they reject, so the
 * validation lives here once -- a second hand-rolled address validator on a
 * money path is how the two flows drift apart.
 */
export default function InsAddressStep({
  title,
  intro,
  inputLabel,
  placeholder = "Enter wallet address",
  feeInKas,
  nextLabel = "Next",
  extraValidate,
  onNext,
  onBack,
}: InsAddressStepProps) {
  const navigate = useNavigate();
  const {
    register,
    setValue,
    formState: { isValid, errors },
  } = useFormContext<InsAddressFormData>();

  const addressValidator = (value: string | undefined) => {
    const trimmed = value?.trim() ?? "";

    // Clear the resolved address on every keystroke so a half-typed address can
    // never leave the previously validated one staged for signing.
    if (!isAddress(trimmed)) {
      setValue("address", undefined);
      return trimmed ? "Invalid address" : false;
    }

    const rejection = extraValidate?.(trimmed);
    if (rejection) {
      setValue("address", undefined);
      return rejection;
    }

    setValue("address", trimmed);
    return true;
  };

  return (
    <>
      <Header
        title={title}
        onClose={() => navigate("/dashboard")}
        onBack={onBack}
      />

      <div className="flex h-full flex-col gap-4">
        {intro}

        <label className="text-base font-medium">{inputLabel}</label>

        <div>
          <textarea
            {...register("userInput", { validate: addressValidator })}
            className={twMerge(
              "no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 text-sm placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0",
              errors.userInput &&
                "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
            )}
            placeholder={placeholder}
          />
          {errors.userInput?.message && (
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

        <button
          disabled={!isValid}
          onClick={onNext}
          className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
        >
          {nextLabel}
        </button>
      </div>
    </>
  );
}
