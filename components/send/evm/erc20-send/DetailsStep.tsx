import Header from "@/components/GeneralHeader";
import { Tooltip } from "react-tooltip";
import { useNavigate } from "react-router-dom";
import { useBoolean } from "usehooks-ts";
import { useFormContext } from "react-hook-form";
import { Erc20SendForm } from "./Erc20Send";
import { twMerge } from "tailwind-merge";
import spinner from "@/assets/images/spinner.svg";
import { useSettings } from "@/hooks/useSettings";
import {
  isAddress,
  formatEther,
  erc20Abi,
  encodeFunctionData,
  parseUnits,
} from "viem";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import useFeeEstimate from "@/hooks/evm/useFeeEstimate";
import { formatToken } from "@/lib/utils";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import { getChainImage } from "@/lib/layer2";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useErc20Balance from "@/hooks/evm/useErc20Balance";
import { Erc20Asset } from "@/contexts/EvmAssets";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";

export default function DetailsStep({
  asset,
  onNext,
  onBack,
}: {
  asset: Erc20Asset;
  onNext: () => void;
  onBack: () => void;
}) {
  const [settings] = useSettings();
  const navigate = useNavigate();
  const {
    register,
    watch,
    setValue,
    trigger,
    formState: { isValid, errors, validatingFields },
  } = useFormContext<Erc20SendForm>();

  const { data: balanceInfo } = useErc20Balance(
    asset.address,
    asset?.decimals,
    asset.chainId,
  );

  const { data: kasBalanceInfo } = useEvmKasBalance(asset.chainId);

  const { balance } = balanceInfo ?? {};
  const currentBalance = parseFloat(balance ?? "0");
  const evmAddress = useEvmAddress();

  const { userInput, address, amount } = watch();

  const payload =
    isAddress(address ?? "") && evmAddress
      ? {
          account: evmAddress,
          to: asset.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [
              address as `0x${string}`,
              amount
                ? parseUnits(amount, asset.decimals)
                : (balanceInfo?.rawBalance ?? 0n),
            ],
          }),
        }
      : undefined;

  const { data: estimatedFee } = useFeeEstimate(asset.chainId, payload);

  // TODO: Add recent address history logic for it
  const { value: isAddressFieldFocused, setValue: setAddressFieldFocused } =
    useBoolean(false);

  const onClose = () => {
    navigate("/dashboard");
  };

  // TODO: Add price when it is available
  const { amount: tokenCurrency } = useCurrencyValue(0);

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address";
    if (!value) return undefined;

    try {
      if (!isAddress(value)) {
        return genericErrorMessage;
      }

      setValue("address", value);
      return true;
    } catch (error) {
      console.error(error);
      return genericErrorMessage;
    }
  };

  const amountValidator = async (value: string | undefined) => {
    const amountNumber = parseFloat(value ?? "0");

    if (amountNumber < 0 || amountNumber > currentBalance) {
      return "Oh, you don’t have enough funds";
    }

    if (amountNumber > currentBalance) {
      return "Oh, you don't have enough funds to cover the estimated fees";
    }

    const kasBalance = kasBalanceInfo?.rawBalance ?? 0n;
    if (!kasBalance || kasBalance < (estimatedFee ?? 0n)) {
      return "You don't have enough KAS to cover the estimated fees";
    }

    return true;
  };

  // Handle empty user input logic
  useEffect(() => {
    if (userInput === "") {
      setValue("address", undefined, { shouldValidate: true });
    }
  }, [userInput]);

  const selectMaxAmount = async () => {
    if (!currentBalance) {
      return;
    }

    const maxAmount = currentBalance;
    setValue("amount", maxAmount > 0 ? maxAmount.toFixed(8) : "0", {
      shouldValidate: true,
    });
  };

  // Update USD amount
  useEffect(() => {
    const amountNumber = parseFloat(amount ?? "0");

    if (!Number.isNaN(amountNumber)) {
      setValue("amountFiat", formatToken(amountNumber * tokenCurrency, 3));
    } else {
      setValue("amountFiat", undefined);
    }
  }, [amount, estimatedFee]);

  useEffect(() => {
    trigger("userInput");
  }, []);

  return (
    <>
      <Header title="Send" onClose={onClose} onBack={onBack} />
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
            placeholder="Enter EVM wallet address"
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
          {errors.userInput && (
            <span className="inline-block text-sm text-red-500">
              {errors.userInput.message}
            </span>
          )}
        </div>

        {/* Amount panel */}
        <div className="bg-white/1 relative flex flex-col gap-4 rounded-xl border border-daintree-700 p-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold">Balance</span>
            <span className="flex-grow">
              {formatToken(parseFloat(balance ?? "0"))} {asset.symbol}
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
                onClick={() => navigate("/asset-select")}
              >
                <Layer2AssetImage
                  tokenImage={asset.image ?? kasIcon}
                  tokenImageSize={24}
                  chainImageSize={14}
                  chainImage={getChainImage(asset.chainId)}
                  chainImageBottomPosition={-2}
                  chainImageRightPosition={-12}
                />
                {asset.symbol}
              </button>
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
                        formatToken(amountUsdNumber / tokenCurrency),
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
          <button className="relative flex items-center gap-2">
            <span>Fee</span>
            <i className="hn hn-cog text-[16px] text-[#4B5563]" />
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
              data-tooltip-content={`${formatToken(parseFloat(formatEther(estimatedFee ?? 0n)))} KAS for EVM miner fees.`}
            ></i>

            <span>Estimated</span>
            <span>
              {formatToken(parseFloat(formatEther(estimatedFee ?? 0n)))} KAS
            </span>
          </div>
        </div>

        <div className="mt-auto">
          <button
            disabled={!isValid || !!errors.amount || !address}
            onClick={onNext}
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
