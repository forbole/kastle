import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import React, { useEffect, useState } from "react";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useNavigate } from "react-router-dom";
import { formatToken } from "@/lib/utils.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import usdIcon from "@/assets/images/usd-icon.svg";
import Header from "@/components/GeneralHeader.tsx";
import useTransactionEstimate from "@/hooks/useTransactionEstimate";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Address } from "@/wasm/core/kaspa";
import { twMerge } from "tailwind-merge";
import { useBoolean } from "usehooks-ts";
import TickerSelect from "@/components/send/TickerSelect.tsx";
import { useTokenBalance } from "@/hooks/useTokenBalance.ts";
import { applyDecimal, computeOperationFees, Fee } from "@/lib/krc20.ts";
import { MIN_KAS_AMOUNT } from "@/lib/kaspa.ts";
import RecentAddresses from "@/components/send/RecentAddresses.tsx";
import spinner from "@/assets/images/spinner.svg";
import { useKns } from "@/hooks/useKns.ts";
import { Tooltip } from "react-tooltip";

export const DetailsStep = ({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();
  const { account, addresses } = useWalletManager();
  const { rpcClient, getMinimumFee } = useRpcClientStateful();
  const { fetchDomainInfo } = useKns();

  const {
    value: isRecentAddressShown,
    setFalse: hideRecentAddress,
    setTrue: showRecentAddress,
  } = useBoolean(false);
  const { value: isTickerSelectShown, toggle: toggleTickerSelect } =
    useBoolean(false);
  const [accountMinimumFees, setAccountMinimumFees] = useState<number>(0.0);

  const {
    register,
    watch,
    setValue,
    setError,
    trigger,
    formState: { isValid, errors, validatingFields },
  } = useFormContext<SendFormData>();
  const { ticker, userInput, address, amount, domain } = watch();
  const { value: isAddressFieldFocused, setValue: setAddressFieldFocused } =
    useBoolean(false);
  const { data: tokenMetadata, toPriceInUsd } = useTokenMetadata(
    ticker === "kas" ? undefined : ticker,
  );
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { kaspaPrice } = useKaspaPrice();
  const tokenPrice = ticker === "kas" ? kaspaPrice : toPriceInUsd();
  const { data: tokenBalanceResponse } = useTokenBalance(
    account?.address && ticker !== "kas"
      ? {
          ticker,
          address: account.address,
        }
      : undefined,
  );

  const tokenBalance = tokenBalanceResponse?.result?.[0];
  const { toFloat } = applyDecimal(tokenBalance?.dec);
  const tokenBalanceFloat = toFloat(
    tokenBalance?.balance ? parseInt(tokenBalance.balance, 10) : 0,
  );
  const kasBalance = account?.balance ? parseFloat(account.balance) : 0;
  const currentBalance = ticker === "kas" ? kasBalance : tokenBalanceFloat;

  const transactionEstimate = useTransactionEstimate({
    account,
    outputs:
      address && amount && !Number.isNaN(parseFloat(amount))
        ? [{ address, amount }]
        : [],
  });

  const amountValidator = async (value: string | undefined) => {
    const amountNumber = parseFloat(value ?? "0");

    if (amountNumber < 0 || amountNumber > currentBalance) {
      return "Oh, you don’t have enough funds";
    }

    if (amountNumber < MIN_KAS_AMOUNT) {
      return "Oh, the minimum sending amount has to be greater than 0.2 KAS";
    }

    if (amountNumber + accountMinimumFees > currentBalance) {
      return "Oh, you don't have enough funds to cover the estimated fees";
    }

    return true;
  };

  const tokenAmountValidator = async (value: string | undefined) => {
    const amountNumber = parseFloat(value ?? "0");

    if (amountNumber < 0 || amountNumber > currentBalance) {
      return "Oh, you don’t have enough funds";
    }

    if (kasBalance < Fee.Base) {
      return "Oh, you don't have enough KAS to cover the operation fees";
    }

    return true;
  };

  const onClose = () => {
    navigate("/dashboard");
  };

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address or KNS domain";
    if (!value) return genericErrorMessage;

    if (ticker !== "kas" && value === account?.address) {
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

    const maxAmount =
      ticker === "kas" ? currentBalance - accountMinimumFees : currentBalance;

    setValue("amount", maxAmount > 0 ? maxAmount.toFixed(8) : "0", {
      shouldValidate: true,
    });
  };

  const navigateToNextStep = () =>
    ticker === "kas"
      ? onNext()
      : navigate(
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

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (ticker === "kas") {
      setImageUrl(kasIcon);
      return;
    }

    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  // Fetch account minimum fees
  useEffect(() => {
    if (rpcClient && account) {
      getMinimumFee(addresses).then(setAccountMinimumFees);
    }
  }, [rpcClient, account]);

  // Update USD amount
  useEffect(() => {
    const amountNumber = parseFloat(amount ?? "0");

    if (!Number.isNaN(amountNumber)) {
      setValue("amountUSD", formatToken(amountNumber * tokenPrice, 3));
    } else {
      setValue("amountUSD", undefined);
    }
  }, [amount, tokenPrice]);

  // Handle recent address list visibility
  useEffect(() => {
    if (userInput === "" && isAddressFieldFocused) {
      showRecentAddress();
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
    trigger("userInput");
  }, [ticker]);

  return (
    <>
      <Header title="Send KAS" onClose={onClose} onBack={onBack} />

      <TickerSelect
        isShown={isTickerSelectShown}
        toggleShow={toggleTickerSelect}
      />

      <div className="relative flex h-full flex-col gap-4">
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
        <div>
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
        </div>

        <RecentAddresses
          isShown={isRecentAddressShown}
          hideAddressSelect={hideRecentAddress}
        />

        {/* Amount panel */}
        <div className="bg-white/1 relative flex flex-col gap-4 rounded-xl border border-daintree-700 p-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold">Balance</span>
            <span className="flex-grow">
              {formatToken(currentBalance)} {ticker.toUpperCase()}
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
                onClick={toggleTickerSelect}
                className={twMerge(
                  "inline-flex min-w-fit items-center gap-2 rounded-s-md border border-e-0 border-daintree-700 px-4 text-sm",
                  errors.amount
                    ? "border-e-0 border-[#EF4444] ring-[#EF4444] focus:border-[#EF4444] focus:ring-[#EF4444]"
                    : "border-daintree-700",
                )}
              >
                <img
                  alt="kas"
                  className="h-[18px] w-[18px]"
                  src={imageUrl}
                  onError={onImageError}
                />
                {ticker.toUpperCase()}
                <i className="hn hn-chevron-down h-[16px] w-[16px]"></i>
              </button>
              <input
                {...register("amount", {
                  required: true,
                  validate:
                    ticker === "kas" ? amountValidator : tokenAmountValidator,
                  onChange: (event) => {
                    const [int, dec] = event.target.value.split(".");

                    if (!!dec && dec !== "") {
                      event.target.value = `${int}.${dec.slice(0, 8)}`;
                    }
                  },
                })}
                type="text"
                className={twMerge(
                  "block w-full rounded-e-lg bg-[#102831] px-4 py-3 pe-11 text-sm shadow-sm focus:z-10 disabled:pointer-events-none disabled:opacity-50 sm:p-5",
                  errors.amount
                    ? "border-[#EF4444] border-l-daintree-700 ring-0 ring-[#EF4444] focus:border-[#EF4444] focus:border-l-daintree-700 focus:ring-0 focus:ring-[#EF4444]"
                    : "border-daintree-700",
                )}
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
                <img alt="kas" className="h-[18px] w-[18px]" src={usdIcon} />
                USD
              </span>
              <input
                {...register("amountUSD", {
                  onChange: async (event) => {
                    const amountUsdNumber = parseFloat(
                      event.target.value ?? "0",
                    );

                    if (!Number.isNaN(amountUsdNumber) && tokenPrice !== 0) {
                      setValue(
                        "amount",
                        (amountUsdNumber / tokenPrice).toFixed(8),
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
        <div className="flex items-center justify-end gap-2 text-sm">
          <span>Fee</span>
          <span>
            {ticker === "kas"
              ? (transactionEstimate?.totalFees ?? "0")
              : computeOperationFees("transfer").totalFees}{" "}
            KAS
          </span>
        </div>

        <div className="mt-auto">
          <button
            disabled={!isValid || !!errors.amount}
            onClick={navigateToNextStep}
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};
