import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import { Address } from "@/wasm/core/kaspa";
import React from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";

export const AddressStep = ({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();
  const {
    register,
    formState: { errors, isValid },
  } = useFormContext<SendFormData>();

  const addressValidator = async (value: string | undefined) => {
    if (!value) return "Missing Kaspa address";

    try {
      return (await Address.validate(value)) || "Invalid Kaspa address";
    } catch (error) {
      return "Invalid Kaspa address";
    }
  };

  const onClose = () => {
    navigate("/dashboard");
  };

  return (
    <>
      <Header title="Send to" onClose={onClose} onBack={onBack} />

      <div className="flex h-full flex-col gap-4">
        <textarea
          {...register("address", {
            required: "Address is required",
            validate: addressValidator,
          })}
          className="w-full resize-none rounded-lg border-0 bg-daintree-800 px-4 py-3 text-sm shadow outline outline-0 focus:ring focus:ring-blue-500/25 disabled:pointer-events-none disabled:opacity-50"
          placeholder="Enter wallet address"
        />
        {errors.address && (
          <span className="text-sm text-red-500">{errors.address.message}</span>
        )}
        <button
          onClick={onNext}
          className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-[#125F78] disabled:bg-daintree-800 disabled:text-[#4B5563]"
          disabled={!isValid || !!errors.address}
        >
          Next
        </button>
      </div>
    </>
  );
};
