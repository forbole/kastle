import Header from "@/components/GeneralHeader.tsx";
import { FormProvider, useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Tooltip } from "react-tooltip";
import spinner from "@/assets/images/spinner.svg";
import React, { useEffect, useState } from "react";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { applyDecimal, computeOperationFees } from "@/lib/krc20.ts";
import { TickerInfoResponse } from "@/hooks/useKasplex.ts";
import { useTokenListByAddress } from "@/hooks/useTokenListByAddress.ts";
import MintTokenItem from "@/components/mint-token/MintTokenItem.tsx";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router";
import kasIcon from "@/assets/images/kas-icon.svg";

export type DeployFormData = {
  ticker: string;
  mintTimes: number;
  maxMintTimes: number;
  mintAmount: number;
};

export default function MintToken() {
  const MIN_MINT_TIMES = 10;
  const MAX_MINT_TIMES = 50;
  const navigate = useNavigate();
  const { state } = useLocation();
  const { fetchTokenInfo } = useKasplex();
  const form = useForm<DeployFormData>({
    mode: "all",
    defaultValues: {
      mintTimes: MIN_MINT_TIMES,
      maxMintTimes: 0,
      mintAmount: 0,
      ...state,
    },
  });
  const { account } = useWalletManager();
  const { data: tokenListResponse } = useTokenListByAddress(account?.address);
  const balance = account?.balance ? parseFloat(account.balance) : 0;
  const [tickerInfo, setTickerInfo] = useState<TickerInfoResponse>();
  const [mintableAmount, setMintableAmount] = useState("-");
  const [showList, setShowList] = useState(false);
  const {
    ticker: tickerInput,
    mintAmount,
    mintTimes,
    maxMintTimes,
  } = form.watch();
  const cappedMaxMint = Math.min(maxMintTimes, MAX_MINT_TIMES);
  const { krc20Fee, kaspaFee, forboleFee, totalFees } = computeOperationFees(
    "mint",
    mintTimes,
  );

  const { data: tokenMetadata } = useTokenMetadata(
    !form.formState.errors.ticker ? tickerInput : undefined,
  );
  const [imageUrl, setImageUrl] = useState(kasIcon);

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  const tokenListItems = tokenListResponse?.result
    ? tokenListResponse.result
    : [];
  const tokens = tokenListItems
    .filter((token) =>
      token.tick?.toLowerCase()?.startsWith(tickerInput?.toLowerCase()),
    )
    .sort((a, b) => {
      const { toFloat: aToFloat } = applyDecimal(a.dec);
      const { toFloat: bToFloat } = applyDecimal(b.dec);

      return (
        bToFloat(parseInt(b.balance, 10)) - aToFloat(parseInt(a.balance, 10))
      );
    });

  const onSubmit = form.handleSubmit(async ({ mintTimes, ticker }) => {
    navigate(
      { pathname: "/confirm-mint" },
      {
        state: {
          ticker,
          mintTimes,
        },
      },
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
      form.setValue("mintAmount", 0);
      setMintableAmount("-");
      return;
    }
    const { toFloat } = applyDecimal(tickerDetails.dec);
    const max = parseInt(tickerDetails.max, 10);
    const minted = parseInt(tickerDetails.minted, 10);
    const mintable = max - minted;
    const mintAmount = toFloat(parseInt(tickerDetails.lim, 10));

    form.setValue(
      "maxMintTimes",
      Math.ceil(mintAmount !== 0 ? mintable / mintAmount : 0),
    );
    form.setValue("mintAmount", mintAmount);
    const percentage =
      Number.isNaN(max) || max === 0 ? 0 : (mintable / max) * 100;
    setMintableAmount(
      `${percentage.toFixed(0)}% (${toFloat(mintable).toLocaleString()}/${toFloat(max).toLocaleString()})`,
    );
  }, [tickerInfo]);

  useEffect(() => {
    if (balance < totalFees) {
      form.setError("root", {
        message: "Oh, you don't have enough funds to cover the estimated fees",
      });
    } else {
      form.clearErrors("root");
    }
  }, [balance, totalFees]);

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title="Mint KRC20"
          showPrevious={false}
          onClose={() => window.close()}
        />
        <FormProvider {...form}>
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
                <div className="absolute flex h-12 w-12 items-center justify-center">
                  <img
                    alt="castle"
                    className="h-[24px] w-[24px] rounded-full"
                    src={imageUrl}
                    onError={onImageError}
                  />
                </div>
                <input
                  onFocus={() => setShowList(true)}
                  className={twMerge(
                    "w-full rounded-lg border-0 bg-daintree-800 px-12 py-3 ring-0 focus:ring-0",
                    form.formState.errors.ticker &&
                      "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
                  )}
                  autoComplete="off"
                  {...form.register("ticker", {
                    onBlur: () => {
                      setTimeout(() => setShowList(false), 250);
                    },
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
                    validate: validateTicker,
                  })}
                />
                <div
                  className={twMerge(
                    "no-scrollbar absolute top-16 z-50 max-h-[26rem] w-full flex-col gap-4 overflow-y-scroll rounded-2xl border border-daintree-700 bg-daintree-800 p-4",
                    showList && tokens.length !== 0 ? "flex" : "hidden",
                  )}
                >
                  {tokens.map((token) => (
                    <MintTokenItem key={token.tick} token={token} />
                  ))}
                </div>
                <div className="pointer-events-none absolute end-0 top-2.5 flex items-center pe-3">
                  {form.formState.validatingFields.ticker && (
                    <img
                      alt="spinner"
                      className="size-7 animate-spin"
                      src={spinner}
                    />
                  )}
                  {!form.formState.validatingFields.ticker &&
                    form.formState.touchedFields.ticker &&
                    !form.formState.errors.ticker && (
                      <i className="hn hn-check rounded-full bg-[#14B8A6] p-1.5 text-[16px]"></i>
                    )}
                </div>
                {form.formState.errors.ticker && (
                  <span className="text-sm text-red-500">
                    {form.formState.errors.ticker.message}
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
              <div className="bg-white/1 rounded-lg border border-daintree-700 px-8 py-4">
                <input
                  type="range"
                  {...form.register("mintTimes", {
                    min: MIN_MINT_TIMES,
                    max: cappedMaxMint,
                    disabled: maxMintTimes < MIN_MINT_TIMES,
                  })}
                  min={MIN_MINT_TIMES}
                  max={cappedMaxMint}
                  step={MIN_MINT_TIMES}
                  className="w-full cursor-pointer appearance-none bg-transparent focus:outline-none disabled:pointer-events-none disabled:opacity-50 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-icy-blue-400 [&::-moz-range-thumb]:bg-icy-blue-400 [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:duration-150 [&::-moz-range-thumb]:ease-in-out [&::-moz-range-track]:h-2 [&::-moz-range-track]:w-full [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-daintree-800 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:w-full [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-daintree-800 [&::-webkit-slider-thumb]:-mt-0.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-daintree-800 [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_#00B1D0] [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:ease-in-out"
                />
                <div className="-mt-1 flex items-center justify-between">
                  <div className="flex flex-col items-center gap-2">
                    <span className="ml-1 self-start text-daintree-600">|</span>
                    <span>{mintAmount * MIN_MINT_TIMES}</span>
                  </div>
                  <div className="mr-1 flex flex-col items-center gap-2">
                    <span className="self-end text-daintree-600">|</span>
                    <span>{mintAmount * cappedMaxMint}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Total Mint amount */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <i
                  className="hn hn-info-circle text-[24px]"
                  data-tooltip-id="info-tooltip"
                  data-tooltip-content="The total number of tokens you’re minting in this transaction."
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
                <span className="text-base">Total Mint amount</span>
                <span className="ml-auto text-base font-semibold">
                  {`${(mintTimes * mintAmount).toLocaleString()} ${tickerInput}`}
                </span>
              </div>
            </div>

            {/* Fees indicator */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i
                    className="hn hn-info-circle text-[24px]"
                    data-tooltip-id="info-tooltip"
                    data-tooltip-content={`Fee Charged Every 10 transactions (${10 * mintAmount} ${tickerInput}).`}
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

                  <span className="text-base">Fee</span>
                </div>
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
                  <span className="text-base font-semibold">
                    {totalFees} KAS
                  </span>
                </div>
              </div>
              {form.formState.errors.root && (
                <span className="self-center text-sm text-red-500">
                  {form.formState.errors.root.message}
                </span>
              )}
            </div>
            <button
              disabled={
                !!form.formState.errors.root ||
                !form.formState.isValid ||
                form.formState.isSubmitting
              }
              type="submit"
              className="mt-auto rounded-full bg-icy-blue-400 py-5 text-base font-semibold hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
            >
              Mint Token
            </button>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
