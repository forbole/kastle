import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import React from "react";
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
  const [accountMinimumFees, setAccountMinimumFees] = useState<number>(0.0);

  const currentBalance = account?.balance
    ? formatToken(parseFloat(account.balance))
    : "0";
  const {
    register,
    watch,
    setValue,
    trigger,
    formState: { isValid, errors },
  } = useFormContext<SendFormData>();
  const { kaspaPrice } = useKaspaPrice();
  const { address, amount } = watch();

  const transactionEstimate = useTransactionEstimate({
    account,
    outputs:
      address && amount && !Number.isNaN(parseFloat(amount))
        ? [{ address, amount }]
        : [],
  });

  const amountValidator = async (value: string | undefined) => {
    const balanceNumber = parseFloat(account?.balance ?? "0");
    const amountNumber = parseFloat(value ?? "0");

    if (amountNumber < 0 || amountNumber > balanceNumber) {
      return "Oh, you don’t have enough funds";
    }

    // Sending amount must be greater than 0.2 KAS as KIP-0009 standard requires
    // https://github.com/kaspanet/kips/blob/master/kip-0009.md
    if (amountNumber < 0.2) {
      return "Oh, the minimum sending amount has to be greater than 0.2 KAS";
    }

    if (amountNumber + accountMinimumFees > balanceNumber) {
      return "Oh, you don't have enough funds to cover the estimated fees";
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
    if (!account?.balance) {
      return;
    }
    const balanceNumber = parseFloat(account?.balance ?? "0");

    const maxAmount = balanceNumber - accountMinimumFees;

    setValue("amount", maxAmount > 0 ? maxAmount.toFixed(8) : "0", {
      shouldValidate: true,
    });
  };

  // Fetch account minimum fees
  useEffect(() => {
    if (rpcClient && account) {
      getMinimumFee(addresses).then(setAccountMinimumFees);
    }
  }, [rpcClient, account]);

  // Update USD amount
  useEffect(() => {
    const amountNumber = parseFloat(amount ?? "0");

    if (!Number.isNaN(amountNumber) && kaspaPrice !== 0) {
      setValue("amountUSD", formatToken(amountNumber * kaspaPrice, 3));
    } else {
      setValue("amountUSD", undefined);
    }
  }, [amount, kaspaPrice]);

  return (
    <>
      <Header title="Send KAS" onClose={onClose} onBack={onBack} />

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
            <span className="flex-grow">{currentBalance} KAS</span>
            <button
              className="inline-flex items-center gap-x-2 rounded border border-transparent bg-icy-blue-400 px-3 py-2 text-sm text-white disabled:pointer-events-none disabled:opacity-50"
              onClick={selectMaxAmount}
            >
              Max
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex rounded-lg bg-[#102831] text-daintree-400 shadow-sm">
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
              <input
                {...register("amount", {
                  required: true,
                  validate: amountValidator,
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

                    if (!Number.isNaN(amountUsdNumber) && kaspaPrice !== 0) {
                      setValue(
                        "amount",
                        (amountUsdNumber / kaspaPrice).toFixed(8),
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
          <span>{transactionEstimate?.totalFees ?? "0"} KAS</span>
        </div>

        <div className="mt-auto">
          <button
            disabled={!isValid || !!errors.amount}
            onClick={onNext}
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
};
