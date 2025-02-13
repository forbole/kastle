import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import React, { useEffect } from "react";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { createSearchParams, useNavigate } from "react-router-dom";
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
import { applyDecimal, Fee } from "@/lib/krc20.ts";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";

export const DetailsStep = ({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack?: () => void;
}) => {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { account, addresses } = useWalletManager();
  const { rpcClient, getMinimumFee } = useRpcClientStateful();

  const { value: isTickerSelectShow, toggle: toogleTickerSelect } =
    useBoolean(false);
  const [accountMinimumFees, setAccountMinimumFees] = useState<number>(0.0);

  const {
    register,
    watch,
    setValue,
    trigger,
    formState: { isValid, errors },
  } = useFormContext<SendFormData>();
  const { ticker, address, amount } = watch();
  const { data: tokenMetadata } = useTokenMetadata(
    ticker === "kas" ? undefined : ticker,
  );
  const { data: tokenInfoResponse } = useTokenInfo(
    ticker === "kas" ? undefined : ticker,
  );
  const { toInteger } = applyDecimal(tokenInfoResponse?.result?.[0].dec);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { kaspaPrice } = useKaspaPrice();
  const tokenPrice =
    ticker === "kas" ? kaspaPrice : (tokenMetadata?.price?.priceInUsd ?? 0);
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

    // Sending amount must be greater than 0.2 KAS as KIP-0009 standard requires
    // https://github.com/kaspanet/kips/blob/master/kip-0009.md
    if (amountNumber < 0.2) {
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
    if (!value) return "Missing Kaspa address";

    try {
      return Address.validate(value) || "Invalid Kaspa address";
    } catch (error) {
      console.error(error);
      return "Invalid Kaspa address";
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

  return (
    <>
      <Header title="Send KAS" onClose={onClose} onBack={onBack} />

      {settings?.preview && (
        <TickerSelect
          isShown={isTickerSelectShow}
          toggleShow={toogleTickerSelect}
        />
      )}

      <div className="flex h-full flex-col gap-4">
        <label className="text-base font-medium">Send to ...</label>
        <textarea
          {...register("address", {
            required: "Address is required",
            validate: addressValidator,
          })}
          className={twMerge(
            "w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0",
            errors.address &&
              "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
          )}
          placeholder="Enter wallet address"
        />
        {errors.address && (
          <span className="text-sm text-red-500">{errors.address.message}</span>
        )}

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
              {settings?.preview ? (
                <button
                  type="button"
                  onClick={toogleTickerSelect}
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
              ) : (
                <span
                  className={twMerge(
                    "inline-flex min-w-fit items-center gap-2 rounded-s-md border border-e-0 border-daintree-700 px-4 text-sm",
                    errors.amount
                      ? "border-e-0 border-[#EF4444] ring-[#EF4444] focus:border-[#EF4444] focus:ring-[#EF4444]"
                      : "border-daintree-700",
                  )}
                >
                  <img alt="kas" className="h-[18px] w-[18px]" src={kasIcon} />
                  KAS
                </span>
              )}
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
              : Fee.Base}{" "}
            KAS
          </span>
        </div>

        <div className="mt-auto">
          <button
            disabled={!isValid || !!errors.amount}
            onClick={() =>
              ticker === "kas"
                ? onNext()
                : navigate({
                    pathname: "/token-operation",
                    search: createSearchParams({
                      op: "transfer",
                      ticker,
                      amount: toInteger(parseFloat(amount ?? "0")).toString(),
                      to: address!,
                    }).toString(),
                  })
            }
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
};
