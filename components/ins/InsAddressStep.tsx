import { useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { Hex, isAddress, zeroAddress } from "viem";
import { Tooltip } from "react-tooltip";
import { twMerge } from "tailwind-merge";
import Header from "@/components/GeneralHeader";
import { textEllipsis } from "@/lib/utils";

export interface InsAddressFormData {
  userInput: string | undefined;
  address: Hex | undefined;
}

type InsAddressStepProps = {
  title: string;
  /** The .igra name this screen acts on. */
  name: string;
  /** Current owner, shown in the disabled "from" field. */
  sender: string | undefined;
  /** Verb in the "<verb> <name> from" line, e.g. "Transfer". */
  action: string;
  inputLabel?: string;
  placeholder?: string;
  /** Formatted KAS, already estimated by the caller for its own payload. */
  feeInKas: string;
  /** Screen-specific rejection, e.g. transferring a name to yourself. */
  extraValidate?: (address: Hex) => string | undefined;
  onNext: () => void;
  onBack: () => void;
};

/**
 * Address entry shared by the transfer and set-target flows, laid out to match
 * the KNS transfer screen. Both take exactly one EVM address and differ only in
 * copy and in what they reject, so the validation lives here once -- a second
 * hand-rolled address validator on a money path is how the two flows drift.
 */
export default function InsAddressStep({
  title,
  name,
  sender,
  action,
  inputLabel = "To ...",
  placeholder = "Enter wallet address",
  feeInKas,
  extraValidate,
  onNext,
  onBack,
}: InsAddressStepProps) {
  const navigate = useNavigate();
  const {
    register,
    watch,
    setValue,
    formState: { isValid, errors },
  } = useFormContext<InsAddressFormData>();
  const { userInput } = watch();

  const addressValidator = (value: string | undefined) => {
    const trimmed = value?.trim() ?? "";

    // Clear the resolved address on every keystroke so a half-typed address can
    // never leave the previously validated one staged for signing.
    if (!isAddress(trimmed)) {
      setValue("address", undefined);
      return trimmed ? "Invalid address" : false;
    }

    // setTarget(name, 0x0) is accepted by both registries and black-holes every
    // incoming send to the name. Nothing here has a legitimate zero recipient.
    if (trimmed.toLowerCase() === zeroAddress) {
      setValue("address", undefined);
      return "Invalid address";
    }

    const rejection = extraValidate?.(trimmed);
    if (rejection) {
      setValue("address", undefined);
      return rejection;
    }

    setValue("address", trimmed);
    return true;
  };

  useEffect(() => {
    if (userInput === "") {
      setValue("address", undefined, { shouldValidate: true });
    }
  }, [userInput]);

  return (
    <>
      <Header
        title={title}
        onClose={() => navigate("/dashboard")}
        onBack={onBack}
      />

      <div className="relative flex h-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <label className="flex gap-1 text-base font-medium">
            <span>{action}</span>
            <span className="text-icy-blue-400">{textEllipsis(name, 20)}</span>
            <span>from</span>
          </label>
        </div>
        <div>
          <textarea
            disabled
            className="no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm text-daintree-400 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0"
            value={sender ?? ""}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-base font-medium">{inputLabel}</label>
          <i
            className="hn hn-lightbulb break-all text-[16px]"
            data-tooltip-id="ins-info-tooltip"
          ></i>
          <Tooltip
            id="ins-info-tooltip"
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
        <div className="relative">
          <textarea
            {...register("userInput", { validate: addressValidator })}
            className={twMerge(
              "no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0",
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

        {/* Fee segment */}
        <div className="flex items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="relative flex cursor-default items-center gap-2"
            disabled
          >
            <span>Fee</span>
            <i
              className="hn hn-cog text-[16px] text-[#4B5563]"
              data-tooltip-id="ins-fee-tooltip"
              data-tooltip-content="Fees are handled automatically by Kastle."
            ></i>
            <Tooltip
              id="ins-fee-tooltip"
              style={{
                backgroundColor: "#203C49",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
              }}
              opacity={1}
            />
          </button>
          <div className="flex items-center gap-2">
            <i
              className="hn hn-info-circle text-[16px]"
              data-tooltip-id="ins-fee-estimation-tooltip"
              data-tooltip-content={`~${feeInKas} KAS for miner fees.`}
            ></i>
            <Tooltip
              id="ins-fee-estimation-tooltip"
              style={{
                backgroundColor: "#203C49",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
              }}
              opacity={1}
            />
            <span>Estimated</span>
            <span>~{feeInKas} KAS</span>
          </div>
        </div>

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
