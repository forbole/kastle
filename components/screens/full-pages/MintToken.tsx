import Header from "@/components/GeneralHeader.tsx";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Tooltip } from "react-tooltip";
import spinner from "@/assets/images/spinner.svg";
import React, { useEffect, useState } from "react";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { setPopupPath } from "@/lib/utils.ts";
import { applyDecimal, Fee } from "@/lib/krc20.ts";
import { TickerInfoResponse } from "@/hooks/useKasplex.ts";

type DeployFormData = {
  ticker: string;
  mintAmount?: number;
};

export default function MintToken() {
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
    setValue,
    setError,
    clearErrors,
  } = useForm<DeployFormData>({
    mode: "all",
  });
  const { account } = useWalletManager();
  const balance = account?.balance ? parseFloat(account.balance) : 0;
  const [tickerInfo, setTickerInfo] = useState<TickerInfoResponse>();
  const [mintableAmount, setMintableAmount] = useState("-");

  const onSubmit = handleSubmit(async (formValues) => {
    const queryParams = new URLSearchParams({
      op: "mint",
      ticker: formValues.ticker,
    });

    setPopupPath(`/token-operation?${queryParams.toString()}`, () =>
      browser.action.openPopup(),
    );
  });

  const validateTicker = async (ticker: string) => {
    const tickerInfo = await fetchTokenInfo(ticker);

    setTickerInfo(tickerInfo);

    switch (tickerInfo?.result?.[0]?.state) {
      case "unused":
      case "ignored":
      case "reserved":
        return "Token does not exists";
      case "finished":
        return "Already fully minted";
      default:
        return undefined;
    }
  };

  useEffect(() => {
    const tickerDetails = tickerInfo?.result?.[0];
    if (!tickerDetails) {
      setValue("mintAmount", 0);
      setMintableAmount("-");
      return;
    }
    const { toFloat } = applyDecimal(tickerDetails.dec);
    const max = parseInt(tickerDetails.max, 10);
    const minted = parseInt(tickerDetails.minted, 10);

    setValue("mintAmount", toFloat(parseInt(tickerDetails.lim, 10)));
    setMintableAmount(
      `${((minted / max) * 100).toFixed(0)}% (${toFloat(minted).toLocaleString()}/${toFloat(max).toLocaleString()})`,
    );
  }, [tickerInfo]);

  useEffect(() => {
    if (balance < Fee.Mint + Fee.Base) {
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

          {/* Mint amount */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i
                  className="hn hn-info-circle text-[24px]"
                  data-tooltip-id="info-tooltip"
                  data-tooltip-content="The specific number of tokens you are about to mint."
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
                <label className="text-base text-gray-200">Mint Amount</label>
              </div>
              <div className="flex items-center gap-2">
                <i
                  className="hn hn-info-circle text-[24px]"
                  data-tooltip-id="info-tooltip"
                  data-tooltip-content="The total number of tokens that are still available to be minted."
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
                  Mintable Amount {mintableAmount}
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <input
                className={twMerge(
                  "w-full rounded-lg border-0 bg-daintree-800 px-4 py-3 ring-0 focus:ring-0",
                  errors.mintAmount &&
                    "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
                )}
                {...register("mintAmount", { disabled: true })}
              />
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
                <span className="text-base font-semibold">
                  {Fee.Mint + Fee.Base} KAS
                </span>
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
            Mint Token
          </button>
        </form>
      </div>
    </div>
  );
}
