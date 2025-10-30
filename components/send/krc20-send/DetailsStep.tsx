import { useFormContext } from "react-hook-form";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatToken } from "@/lib/utils.ts";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import Header from "@/components/GeneralHeader.tsx";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { Address, kaspaToSompi, sompiToKaspaString } from "@/wasm/core/kaspa";
import { twMerge } from "tailwind-merge";
import { useBoolean } from "usehooks-ts";
import { useTokenBalance } from "@/hooks/kasplex/useTokenBalance";
import { applyDecimal, computeOperationFees, Krc20Fee } from "@/lib/krc20.ts";
import RecentAddresses from "@/components/send/RecentAddresses.tsx";
import spinner from "@/assets/images/spinner.svg";
import { useKns } from "@/hooks/kns/useKns";
import { Tooltip } from "react-tooltip";
import PriorityFeeSelection from "@/components/send/PriorityFeeSelection.tsx";
import useMassCalculation from "@/hooks/useMassCalculation.ts";
import usePriorityFeeEstimate from "@/hooks/usePriorityFeeEstimate.ts";
import useMempoolStatus from "@/hooks/useMempoolStatus.ts";
import "/node_modules/flag-icons/css/flag-icons.min.css";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenMetadata } from "@/hooks/kasplex/useTokenMetadata.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { KRC20SendForm } from "./Krc20Send";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";

export const DetailsStep = () => {
  const { tick: ticker } = useParams<{ tick: string }>();
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { account } = useWalletManager();
  const { mempoolCongestionLevel } = useMempoolStatus();
  const { fetchDomainInfo } = useKns();
  const { value: isAddressFieldFocused, setValue: setAddressFieldFocused } =
    useBoolean(false);

  const {
    value: isRecentAddressShown,
    setFalse: hideRecentAddress,
    setTrue: showRecentAddress,
  } = useBoolean(false);

  const {
    register,
    watch,
    setValue,
    setError,
    trigger,
    formState: { isValid, errors, validatingFields },
  } = useFormContext<KRC20SendForm>();

  const { userInput, address, amount, domain, priority, priorityFee } = watch();
  const priorityFeeEstimate = usePriorityFeeEstimate();
  const estimatedMass = useMassCalculation(
    address
      ? [
          {
            address: address,
            amount: kaspaToSompi(amount ?? "0") ?? 0n,
          },
        ]
      : [],
  );

  const { data: tokenMetadata, toPriceInUsd } = useTokenMetadata(ticker);
  const tokenPrice = toPriceInUsd();
  const { amount: tokenCurrency } = useCurrencyValue(tokenPrice);
  const { data: tokenBalanceResponse } = useTokenBalance(
    account?.address && ticker
      ? {
          tokenId: ticker,
          address: account.address,
        }
      : undefined,
  );
  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const tokenName = tokenInfoResponse?.result?.[0]?.name ?? ticker;

  const tokenBalance = tokenBalanceResponse?.result?.[0];
  const { toFloat } = applyDecimal(tokenBalance?.dec);
  const tokenBalanceFloat = toFloat(
    tokenBalance?.balance ? parseInt(tokenBalance.balance, 10) : 0,
  );
  const kasBalance = useKaspaBalance(account?.address) ?? 0;
  const currentBalance = tokenBalanceFloat;

  const tokenAmountValidator = async (value: string | undefined) => {
    const amountNumber = parseFloat(value ?? "0");

    if (amountNumber < 0 || amountNumber > currentBalance) {
      return "Oh, you don’t have enough funds";
    }

    if (kasBalance < Krc20Fee.Base) {
      return "Oh, you don't have enough KAS to cover the operation fees";
    }

    return true;
  };

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address or KNS domain";
    if (!value) return undefined;

    if (value === account?.address) {
      return "You cannot send KRC20 to yourself";
    }

    const domainInfo = value.endsWith(".kas")
      ? await fetchDomainInfo(value)
      : undefined;
    const resolvedAddress = domainInfo?.data?.owner;

    const isValidKnsRecord = () => {
      const outcome = !!resolvedAddress && Address.validate(resolvedAddress);

      if (outcome) {
        setValue("address", resolvedAddress);
        setValue("domain", value);
        setError("userInput", { message: undefined });
      } else {
        setValue("address", undefined);
        setValue("domain", undefined);
      }

      return outcome;
    };

    const isValidKaspaAddress = () => {
      const isValid = Address.validate(value);

      setValue("address", isValid ? value : undefined);

      return isValid;
    };

    try {
      return isValidKnsRecord() || isValidKaspaAddress() || genericErrorMessage;
    } catch (error) {
      console.error(error);
      return genericErrorMessage;
    }
  };

  const selectMaxAmount = async () => {
    if (!currentBalance) {
      return;
    }

    const maxAmount = currentBalance;
    setValue("amount", maxAmount > 0 ? maxAmount.toFixed(8) : "0", {
      shouldValidate: true,
    });
  };

  const navigateToNextStep = () =>
    navigate(
      {
        pathname: "/token-transfer",
      },
      {
        state: {
          ticker,
          amount,
          to: address,
          domain,
        },
      },
    );

  // Update USD amount
  useEffect(() => {
    const amountNumber = parseFloat(amount ?? "0");

    if (!Number.isNaN(amountNumber)) {
      setValue("amountFiat", formatToken(amountNumber * tokenCurrency, 3));
    } else {
      setValue("amountFiat", undefined);
    }
  }, [amount, tokenPrice]);

  // Handle recent address list visibility
  useEffect(() => {
    if (userInput === "" && isAddressFieldFocused) {
      showRecentAddress();
    } else if (userInput !== "") {
      hideRecentAddress();
    }
  }, [userInput, isAddressFieldFocused]);

  // Handle empty user input logic
  useEffect(() => {
    if (userInput === "") {
      setValue("domain", undefined, { shouldValidate: true });
      setValue("address", undefined, { shouldValidate: true });
    }
  }, [userInput]);

  useEffect(() => {
    const selectedPriorityFee = (() => {
      if (priority === "low") {
        return (
          (priorityFeeEstimate?.estimate?.lowBuckets?.[0]?.feerate ?? 0) *
          Number(estimatedMass)
        );
      }
      if (priority === "medium") {
        return (
          (priorityFeeEstimate?.estimate?.normalBuckets?.[0]?.feerate ?? 0) *
          Number(estimatedMass)
        );
      }
      return (
        (priorityFeeEstimate?.estimate?.priorityBucket?.feerate ?? 0) *
        Number(estimatedMass)
      );
    })();

    setValue("priorityFee", BigInt(Math.round(selectedPriorityFee)));
  }, [estimatedMass, priorityFeeEstimate, priority]);

  useEffect(() => {
    trigger("userInput");
  }, []);

  const onClose = () => {
    navigate("/dashboard");
  };

  const toAssetSelectPage = () => {
    navigate("/asset-select");
  };

  return (
    <>
      <Header title="Send" onClose={onClose} onBack={toAssetSelectPage} />
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <label className="text-base font-medium">Send to ...</label>
          <i
            className="hn hn-lightbulb break-all text-[16px]"
            data-tooltip-id="info-tooltip"
          ></i>
          <Tooltip
            id="info-tooltip"
            style={{
              backgroundColor: "#374151",
              fontSize: "12px",
              fontWeight: 600,
              padding: "2px 8px",
            }}
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
            onFocus={() => setAddressFieldFocused(true)}
            {...register("userInput", {
              validate: addressValidator,
              onBlur: () => setAddressFieldFocused(false),
            })}
            className={twMerge(
              "no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0",
              errors.userInput &&
                "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
            )}
            placeholder="Enter wallet address or KNS"
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
          {domain && (
            <span className="inline-block break-all text-sm text-daintree-400">
              {address}
            </span>
          )}
          {errors.userInput && (
            <span className="inline-block text-sm text-red-500">
              {errors.userInput.message}
            </span>
          )}
          <RecentAddresses
            isShown={isRecentAddressShown}
            hideAddressSelect={hideRecentAddress}
          />
        </div>

        {/* Amount panel */}
        <div className="bg-white/1 relative flex flex-col gap-4 rounded-xl border border-daintree-700 p-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold">Balance</span>
            <span className="flex-grow">
              {formatToken(currentBalance)} {tokenName?.toUpperCase()}
            </span>
            <button
              className="inline-flex items-center gap-x-2 rounded border border-transparent bg-icy-blue-400 px-3 py-2 text-sm text-white disabled:pointer-events-none disabled:opacity-50"
              onClick={selectMaxAmount}
            >
              Max
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex rounded-lg bg-[#102831] text-daintree-400 shadow-sm">
              <button
                type="button"
                className={twMerge(
                  "inline-flex min-w-fit items-center gap-3 rounded-s-md border border-e-0 border-daintree-700 p-4 text-sm",
                  errors.amount
                    ? "border-e-0 border-[#EF4444] ring-[#EF4444] focus:border-[#EF4444] focus:ring-[#EF4444]"
                    : "border-daintree-700",
                )}
                onClick={toAssetSelectPage}
              >
                <Layer2AssetImage
                  tokenImage={tokenMetadata?.iconUrl ?? kasIcon}
                  tokenImageSize={24}
                  chainImageSize={14}
                  chainImage={kasIcon}
                  chainImageBottomPosition={-2}
                  chainImageRightPosition={-12}
                />
                {tokenName?.toUpperCase()}
              </button>
              <input
                {...register("amount", {
                  required: true,
                  validate: tokenAmountValidator,
                  onChange: (event) => {
                    const [int, dec] = event.target.value.split(".");

                    if (!!dec && dec !== "") {
                      event.target.value = `${int}.${dec.slice(0, 8)}`;
                    }
                  },
                })}
                type="number"
                className={twMerge(
                  "block w-full rounded-e-lg bg-[#102831] px-4 py-3 pe-11 text-sm shadow-sm focus:z-10 disabled:pointer-events-none disabled:opacity-50 sm:p-5 [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                  errors.amount
                    ? "border-[#EF4444] border-l-daintree-700 ring-0 ring-[#EF4444] focus:border-[#EF4444] focus:border-l-daintree-700 focus:ring-0 focus:ring-[#EF4444]"
                    : "border-daintree-700",
                )}
                style={{ MozAppearance: "textfield" }}
              />
            </div>

            <div className="flex rounded-lg bg-[#102831] text-daintree-400 shadow-sm">
              <span
                className={twMerge(
                  "inline-flex min-w-fit items-center gap-2 rounded-s-md border border-e-0 border-daintree-700 px-4 text-sm",
                  errors.amount
                    ? "border-e-0 border-[#EF4444] ring-[#EF4444] focus:border-[#EF4444] focus:ring-[#EF4444]"
                    : "border-daintree-700",
                )}
              >
                <span
                  className={twMerge(
                    `fi fi-${settings?.currency.slice(0, 2).toLocaleLowerCase()} fis rounded-full`,
                  )}
                ></span>
                {settings?.currency}
              </span>
              <input
                {...register("amountFiat", {
                  onChange: async (event) => {
                    const amountUsdNumber = parseFloat(
                      event.target.value ?? "0",
                    );

                    if (!Number.isNaN(amountUsdNumber) && tokenCurrency !== 0) {
                      setValue(
                        "amount",
                        (amountUsdNumber / tokenCurrency).toFixed(8),
                      );

                      await trigger("amount");
                    }
                  },
                })}
                type="text"
                className={twMerge(
                  "focus:borderblue-500/25 focus:ringblue-500/25 block w-full rounded-e-lg border-daintree-700 bg-[#102831] px-3 py-2 pe-11 text-sm shadow-sm focus:z-10 disabled:pointer-events-none disabled:opacity-50",
                  errors.amount
                    ? "border-[#EF4444] border-l-daintree-700 ring-0 ring-[#EF4444] focus:border-[#EF4444] focus:border-l-daintree-700 focus:ring-0 focus:ring-[#EF4444]"
                    : "border-daintree-700",
                )}
              />
            </div>
          </div>

          {/* Error */}
          {errors.amount && errors.amount?.message !== "" && (
            <span className="text-sm text-red-500">
              {errors.amount?.message ?? "Oh, you don’t have enough funds"}
            </span>
          )}
        </div>

        {/* Fee segment */}
        <div className="flex items-center justify-between gap-2 text-sm">
          <button className="relative flex cursor-default items-center gap-2">
            {mempoolCongestionLevel === "medium" && (
              <span className="absolute -end-1 top-0 -me-1.5 -mt-1.5 flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#E9B306] opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-[#E9B306]"></span>
              </span>
            )}
            {mempoolCongestionLevel === "high" && (
              <span className="absolute -end-1 top-0 -me-1.5 -mt-1.5 flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#EF4444] opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-[#EF4444]"></span>
              </span>
            )}
            <span>Fee</span>
            <i
              className="hn hn-cog text-[16px] text-[#4B5563]"
              data-tooltip-id="fee-tooltip"
              data-tooltip-content="KRC20 fees are handled automatically by Kastle."
            ></i>
            <Tooltip
              id="fee-tooltip"
              style={{
                backgroundColor: "#374151",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
              }}
            />
          </button>
          <div className="flex items-center gap-2">
            <Tooltip
              id="fee-estimation-tooltip"
              style={{
                backgroundColor: "#374151",
                fontSize: "12px",
                fontWeight: 600,
                padding: "2px 8px",
              }}
            />
            <i
              className="hn hn-info-circle text-[16px]"
              data-tooltip-id="fee-estimation-tooltip"
              data-tooltip-content={`${sompiToKaspaString(priorityFee)} KAS for miner fees.`}
            ></i>

            <span>Estimated</span>
            <span>{computeOperationFees("transfer").totalFees} KAS</span>
          </div>
        </div>

        <div className="mt-auto">
          <button
            disabled={!isValid || !!errors.amount || !address}
            onClick={navigateToNextStep}
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Next
          </button>
        </div>
      </div>

      <PriorityFeeSelection
        isPriorityFeeSelectionOpen={false}
        closePriorityFeeSelection={() => {}}
      />
    </>
  );
};
