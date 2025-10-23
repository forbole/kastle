import Header from "@/components/GeneralHeader.tsx";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Tooltip } from "react-tooltip";
import spinner from "@/assets/images/spinner.svg";
import React from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { applyDecimal, computeOperationFees } from "@/lib/krc20.ts";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router";
import { useKasplex } from "@/hooks/kasplex/useKasplex.ts";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";

type DeployFormData = {
  ticker: string;
  maxSupply: number;
  mintAmount: number;
  preAllocation: number;
  decimalPlaces: number;
};

export type DeployTokenState = {
  ticker: string;
  maxSupply: number;
  mintAmount: number;
  preAllocation: number;
  decimalPlaces: number;
};

export default function DeployToken() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { fetchTokenInfo } = useKasplex();
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
    setError,
    clearErrors,
  } = useForm<DeployFormData>({
    mode: "all",
    defaultValues: {
      maxSupply: 100000000,
      mintAmount: 1000,
      preAllocation: 0,
      decimalPlaces: 8,
      ...state,
    },
  });
  const maxSupply = watch("maxSupply");
  const formattedMaxSupply = Number.isNaN(maxSupply) ? 0 : maxSupply;
  const { account } = useWalletManager();
  const balance = useKaspaBalance(account?.address) ?? 0;
  const maxSupplyLength = useRef(0);
  const { krc20Fee, kaspaFee, forboleFee, totalFees } =
    computeOperationFees("deploy");

  const onSubmit = handleSubmit(async (formValues) => {
    const { toInteger } = applyDecimal(formValues.decimalPlaces.toString());

    navigate(
      { pathname: "/confirm-deploy" },
      {
        state: {
          op: "deploy",
          ticker: formValues.ticker,
          maxSupply: toInteger(formValues.maxSupply),
          mintAmount: toInteger(formValues.mintAmount),
          preAllocation: toInteger(formValues.preAllocation),
          decimalPlaces: formValues.decimalPlaces,
        },
      },
    );
  });

  const validateToken = async (tokenId: string) => {
    const tickerInfo = await fetchTokenInfo(tokenId);

    return tickerInfo?.result?.[0]?.state !== "unused"
      ? "Oh, this ticker has already been used"
      : undefined;
  };

  const validateMaxSupply = async (supply: number) => {
    if (supply < 0) {
      return "Maximum supply must be greater than 0";
    }

    if (maxSupplyLength.current > 32) {
      return "The number of digits in maximum supply should be less or equal to 32";
    }

    return undefined;
  };

  useEffect(() => {
    if (balance < totalFees) {
      setError("root", {
        message: "Oh, you don't have enough funds to cover the estimated fees",
      });
    } else {
      clearErrors("root");
    }
  }, [balance]);

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title="Deploy KRC20"
          showPrevious={false}
          onClose={() => window.close()}
        />
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
              <label className="text-base text-gray-200">Ticker</label>
            </div>
            <div className="relative flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 ring-0 focus:ring-0",
                  errors.ticker &&
                    "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
                )}
                {...register("ticker", {
                  onChange: (event) => {
                    event.target.value = event.target.value
                      .replace(/[^a-zA-Z]/g, "")
                      .slice(0, 6)
                      .toUpperCase();
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
                  validate: validateToken,
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
              <label className="text-base text-gray-200">Maximum Supply</label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 ring-0 focus:ring-0",
                  errors.maxSupply &&
                    "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
                )}
                {...register("maxSupply", {
                  onChange: (event) => {
                    maxSupplyLength.current = event.target.value.replaceAll(
                      ".",
                      "",
                    ).length;

                    event.target.value = event.target.value.replace(
                      /[^0-9.]/g,
                      "",
                    );
                  },
                  valueAsNumber: true,
                  required: "Oh, maximum supply is required",
                  validate: validateMaxSupply,
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
              <label className="text-base text-gray-200">
                Default Mint Amount{" "}
                <span className="text-daintree-400">
                  (0 ~ {formattedMaxSupply})
                </span>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 ring-0 focus:ring-0",
                  errors.mintAmount &&
                    "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
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
              <label className="text-base text-gray-200">
                Preallocation{" "}
                <span className="text-daintree-400">(Optional)</span>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:ring-0",
                  errors.preAllocation &&
                    "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
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
              <label className="text-base text-gray-200">
                Decimal <span className="text-daintree-400">(Optional)</span>
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:ring-0",
                  errors.decimalPlaces &&
                    "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
                )}
                {...register("decimalPlaces", {
                  onChange: (event) => {
                    event.target.value = event.target.value.replace(
                      /[^0-9]/g,
                      "",
                    );
                  },
                  min: {
                    value: 0,
                    message: "Decimal value should be a positive number",
                  },
                  max: {
                    value: 32,
                    message: "Decimal value should be less then 32",
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
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-base">Fee</span>
              <div className="flex items-center gap-2">
                <i
                  className="hn hn-info-circle text-[24px]"
                  data-tooltip-id="info-tooltip"
                  data-tooltip-content={
                    forboleFee > 0
                      ? `${krc20Fee} KAS for KRC20 fees, ${kaspaFee} KAS for Kaspa network fees and ${forboleFee} KAS for Kastle fees.`
                      : `${krc20Fee} KAS for KRC20 fees and ${kaspaFee} KAS for Kaspa network fees.`
                  }
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
                <span className="text-base font-semibold">{totalFees} KAS</span>
              </div>
            </div>
            {errors.root && (
              <span className="self-center text-sm text-red-500">
                {errors.root.message}
              </span>
            )}
          </div>
          <button
            disabled={!!errors.root || !isValid || isSubmitting}
            type="submit"
            className="mt-auto rounded-full bg-icy-blue-400 py-5 text-base font-semibold hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Deploy Token
          </button>
        </form>
      </div>
    </div>
  );
}
