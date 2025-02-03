import Header from "@/components/GeneralHeader";
import { useForm } from "react-hook-form";
import { useKasplex } from "@/hooks/useKasplex.ts";
import { twMerge } from "tailwind-merge";
import { Tooltip } from "react-tooltip";
import spinner from "@/assets/images/spinner.svg";
import React from "react";

type DeployFormData = {
  ticker: string;
  maxSupply: number;
  mintAmount: number;
  preAllocation: number;
  decimalPlaces: number;
};

export default function DeployToken() {
  const { kasplexUrl } = useKasplex();
  const {
    formState: {
      errors,
      isValid,
      isSubmitting,
      validatingFields,
      touchedFields,
    },
    handleSubmit,
    register,
    watch,
  } = useForm<DeployFormData>({
    mode: "all",
    defaultValues: {
      maxSupply: 100000000,
      mintAmount: 1000,
      preAllocation: 0,
      decimalPlaces: 8,
    },
  });
  const maxSupply = watch("maxSupply");
  const formattedMaxSupply = Number.isNaN(maxSupply) ? 0 : maxSupply;

  const onSubmit = handleSubmit(async (formValues) => {
    const queryParams = new URLSearchParams({
      op: "deploy",
      ticker: formValues.ticker,
      maxSupply: formValues.maxSupply.toString(),
      mintAmount: formValues.mintAmount.toString(),
      preAllocation: formValues.preAllocation.toString(),
      decimalPlaces: formValues.decimalPlaces.toString(),
    });

    browser.action.setPopup(
      { popup: `popup.html#/token-operation?${queryParams.toString()}` },
      () => browser.action.openPopup(),
    );
  });

  const validateTicker = async (ticker: string) => {
    type TicketInfo = { result: Array<{ state: string }> };

    const response = await fetch(`${kasplexUrl}/krc20/token/${ticker}`);
    const tickerInfo = (await response.json()) as TicketInfo;

    return tickerInfo?.result?.[0]?.state !== "unused"
      ? "Oh, this ticker has already been used"
      : undefined;
  };

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header title="Deploy KRC20" />
        <form onSubmit={onSubmit} className="flex flex-grow flex-col gap-6">
          {/*Ticker input group*/}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content="Short, unique abbreviation that represents your token, like BTC for Bitcoin."
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <label className="text-base text-[#E5E7EB]">Ticker</label>
            </div>
            <div className="relative flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-400 focus:outline-none",
                  errors.ticker
                    ? "border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "focus:border-gray-600 focus:ring-2 focus:ring-gray-500",
                )}
                {...register("ticker", {
                  onChange: (event) => {
                    event.target.value = event.target.value.replace(
                      /[^a-zA-Z]/g,
                      "",
                    );
                  },
                  required: "Oh, ticker is required",
                  minLength: {
                    value: 4,
                    message: "Oh, ticker must be at least 4 characters long",
                  },
                  maxLength: {
                    value: 6,
                    message: "Oh, ticker must be at most 6 characters long",
                  },
                  validate: validateTicker,
                })}
              />
              <div className="pointer-events-none absolute end-0 top-2.5 flex items-center pe-3">
                {validatingFields.ticker && (
                  <img
                    alt="spinner"
                    className="size-7 animate-spin"
                    src={spinner}
                  />
                )}
                {!validatingFields.ticker &&
                  touchedFields.ticker &&
                  !errors.ticker && (
                    <i className="hn hn-check rounded-full bg-[#14B8A6] p-1.5 text-[16px]"></i>
                  )}
              </div>
              {errors.ticker && (
                <span className="text-sm text-red-500">
                  {errors.ticker.message}
                </span>
              )}
            </div>
          </div>

          {/*Max supply input group*/}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content="The total number of tokens that will ever exist for your token."
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <label className="text-base text-[#E5E7EB]">Maximum Supply</label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-400 focus:outline-none",
                  errors.maxSupply
                    ? "border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "focus:border-gray-600 focus:ring-2 focus:ring-gray-500",
                )}
                {...register("maxSupply", {
                  onChange: (event) => {
                    event.target.value = event.target.value.replace(
                      /[^0-9.]/g,
                      "",
                    );
                  },
                  valueAsNumber: true,
                  required: "Oh, maximum supply is required",
                  min: {
                    value: 1,
                    message: "The amount should be above 0",
                  },
                })}
              />
              {errors.maxSupply && (
                <span className="text-sm text-red-500">
                  {errors.maxSupply.message}
                </span>
              )}
            </div>
          </div>

          {/* Mint amount */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content="The number of tokens minted each time you perform a minting operation."
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <label className="text-base text-[#E5E7EB]">
                Default Mint Amount{" "}
                <span className="text-daintree-400">
                  (0 ~ {formattedMaxSupply})
                </span>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-400 focus:outline-none",
                  errors.mintAmount
                    ? "border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "focus:border-gray-600 focus:ring-2 focus:ring-gray-500",
                )}
                {...register("mintAmount", {
                  onChange: (event) => {
                    event.target.value = event.target.value.replace(
                      /[^0-9.]/g,
                      "",
                    );
                  },
                  valueAsNumber: true,
                  required: "Oh, default mint amount supply is required",
                  max: {
                    value: formattedMaxSupply,
                    message: `Oh, the default mint amount should be at most ${formattedMaxSupply}`,
                  },
                })}
              />
              {errors.mintAmount && (
                <span className="text-sm text-red-500">
                  {errors.mintAmount.message}
                </span>
              )}
            </div>
          </div>

          {/* Pre allocation */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content="A portion of the total tokens that are created and assigned to you (the deployer) right away."
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <label className="text-base text-[#E5E7EB]">
                Preallocation{" "}
                <span className="text-daintree-400">(Optional)</span>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-400 focus:outline-none",
                  errors.preAllocation
                    ? "border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "focus:border-gray-600 focus:ring-2 focus:ring-gray-500",
                )}
                {...register("preAllocation", {
                  onChange: (event) => {
                    event.target.value = event.target.value.replace(
                      /[^0-9.]/g,
                      "",
                    );
                  },
                  valueAsNumber: true,
                  max: {
                    value: formattedMaxSupply,
                    message: `Oh, the default mint amount should be at most ${formattedMaxSupply}`,
                  },
                })}
                placeholder="0"
              />
              {errors.preAllocation && (
                <span className="text-sm text-red-500">
                  {errors.preAllocation.message}
                </span>
              )}
            </div>
          </div>

          {/* Decimal places*/}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content="The number of decimal points your token can be divided into."
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <label className="text-base text-[#E5E7EB]">
                Decimal <span className="text-daintree-400">(Optional)</span>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-400 focus:outline-none",
                  errors.decimalPlaces
                    ? "border-red-700 focus:border-red-600 focus:ring-red-800"
                    : "focus:border-gray-600 focus:ring-2 focus:ring-gray-500",
                )}
                {...register("decimalPlaces", {
                  onChange: (event) => {
                    event.target.value = event.target.value.replace(
                      /[^0-9.]/g,
                      "",
                    );
                  },
                  valueAsNumber: true,
                })}
                placeholder="8"
              />
              {errors.decimalPlaces && (
                <span className="text-sm text-red-500">
                  {errors.decimalPlaces.message}
                </span>
              )}
            </div>
          </div>

          {/* Fees indicator */}
          <div className="flex items-center justify-between">
            <span className="text-base">Fee</span>
            <div className="flex items-center gap-2">
              <i
                className="hn hn-info-circle text-[24px]"
                data-tooltip-id="info-tooltip"
                data-tooltip-content="1000 KAS for Miner deployment fee and 0.0001 Kas for Transaction Fee ."
              ></i>
              <Tooltip
                id="info-tooltip"
                style={{
                  backgroundColor: "#374151",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                }}
              />
              <span className="text-base">Estimated Fee</span>
              <span className="text-base font-semibold">1000.0001 KAS</span>
            </div>
          </div>
          <button
            disabled={!isValid || isSubmitting}
            type="submit"
            className="mt-auto rounded-full bg-icy-blue-400 py-5 text-base font-semibold disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Deploy Token
          </button>
        </form>
      </div>
    </div>
  );
}
