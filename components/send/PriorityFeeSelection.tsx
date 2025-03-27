import { twMerge } from "tailwind-merge";
import React from "react";
import { SendFormData } from "@/components/screens/Send.tsx";
import { useFormContext } from "react-hook-form";

type Priority = SendFormData["priority"];
type PriorityFeeSelectionProps = {
  isPriorityFeeSelectionOpen: boolean;
  closePriorityFeeSelection: () => void;
};

export default function PriorityFeeSelection({
  isPriorityFeeSelectionOpen,
  closePriorityFeeSelection,
}: PriorityFeeSelectionProps) {
  const { setValue, watch } = useFormContext<SendFormData>();
  const selectedPriority = watch("priority");
  const networkCongestion = "low" as Priority; // TODO

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isPriorityFeeSelectionOpen
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={closePriorityFeeSelection}
      />
      <div
        className={twMerge(
          "no-scrollbar absolute bottom-0 left-0 z-50 flex h-[14rem] w-full transform flex-col gap-6 rounded-t-2xl border border-daintree-700 bg-daintree-800 p-6 transition-transform duration-300 ease-out",
          isPriorityFeeSelectionOpen ? "translate-y-0" : "translate-y-[14rem]",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold">Fee & Speed</span>
          {networkCongestion === "low" && (
            <span className="inline-flex items-center gap-x-1.5 rounded-full bg-[#115E594D] px-2.5 py-1.5 text-xs font-medium text-[#14B8A6]">
              <span className="inline-block size-1.5 rounded-full bg-[#14B8A6]"></span>
              Network: Smooth
            </span>
          )}
          {networkCongestion === "medium" && (
            <span className="inline-flex items-center gap-x-1.5 rounded-full bg-[#854D0E4D] px-2.5 py-1.5 text-xs font-medium text-[#EAB308]">
              <span className="inline-block size-1.5 rounded-full bg-[#EAB308]"></span>
              Network: Smooth
            </span>
          )}
          {networkCongestion === "high" && (
            <span className="inline-flex items-center gap-x-1.5 rounded-full bg-[#991B1B4D] px-2.5 py-1.5 text-xs font-medium text-[#EF4444]">
              <span className="inline-block size-1.5 rounded-full bg-[#EF4444]"></span>
              Network: Smooth
            </span>
          )}
        </div>

        <div className="shadow-2xs flex grow items-center divide-x divide-[#203C49] rounded-lg border border-[#203C49]">
          <button
            type="button"
            className={twMerge(
              "flex grow flex-col items-center justify-center rounded-s-lg p-5",
              selectedPriority === "low"
                ? "bg-icy-blue-800"
                : "bg-icy-blue-950",
            )}
            onClick={() => setValue("priority", "low")}
          >
            <span className="text-base font-semibold">Low</span>
            <span>Low</span>
          </button>
          <button
            type="button"
            className={twMerge(
              "relative flex grow flex-col items-center justify-center p-5",
              selectedPriority === "medium"
                ? "bg-icy-blue-800"
                : "bg-icy-blue-950",
            )}
            onClick={() => setValue("priority", "medium")}
          >
            <span className="absolute -top-2.5 rounded bg-icy-blue-400 px-1.5 py-0.5 text-[10px]">
              Recommended
            </span>
            <span className="text-base font-semibold">Med</span>
            <span>Med</span>
          </button>
          <button
            type="button"
            className={twMerge(
              "flex grow flex-col items-center justify-center rounded-e-lg p-5",
              selectedPriority === "high"
                ? "bg-icy-blue-800"
                : "bg-icy-blue-950",
            )}
            onClick={() => setValue("priority", "high")}
          >
            <span className="text-base font-semibold">High</span>
            <span>High</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-daintree-400">
          <i className="hn hn-info-circle text-[16px]"></i>
          <span>Higher fees help confirm your transaction faster.</span>
        </div>
      </div>
    </>
  );
}
