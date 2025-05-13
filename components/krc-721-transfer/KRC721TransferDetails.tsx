import { useFormContext } from "react-hook-form";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { Address } from "@/wasm/core/kaspa";
import { twMerge } from "tailwind-merge";
import { useBoolean } from "usehooks-ts";
import RecentAddresses from "@/components/send/RecentAddresses.tsx";
import spinner from "@/assets/images/spinner.svg";
import { Tooltip } from "react-tooltip";
import { KRC721TransferFormData } from "@/components/screens/KRC721Transfer.tsx";
import { Fee } from "@/lib/krc721";
import { useKns } from "@/hooks/useKns.ts";
import { convertIPFStoHTTP } from "@/lib/utils.ts";

type KRC721TransferDetailsProps = {
  onNext: () => void;
  onBack?: () => void;
};

export const KRC721TransferDetails = ({
  onNext,
  onBack,
}: KRC721TransferDetailsProps) => {
  const navigate = useNavigate();
  const { account } = useWalletManager();
  const { fetchDomainInfo } = useKns();
  const {
    register,
    watch,
    setValue,
    setError,
    formState: { isValid, errors, validatingFields },
  } = useFormContext<KRC721TransferFormData>();
  const { tick, tokenId, userInput, address, domain } = watch();

  const {
    value: isRecentAddressShown,
    setFalse: hideRecentAddress,
    setTrue: showRecentAddress,
  } = useBoolean(false);

  const { data } = useKRC721Details(tick, tokenId);

  const { value: isAddressFieldFocused, setValue: setAddressFieldFocused } =
    useBoolean(false);
  const kasBalance = account?.balance ? parseFloat(account.balance) : 0;
  const currentBalance = kasBalance;

  const onClose = () => navigate("/dashboard");

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address or KRC721 domain";
    if (!value) return false;

    if (currentBalance < Fee.Base) {
      return "Oh, you don’t have enough funds";
    }

    if (value === account?.address) {
      return "You cannot send NFT to yourself";
    }

    const domainInfo = value.endsWith(".kas")
      ? await fetchDomainInfo(value)
      : undefined;
    const resolvedAddress = domainInfo?.data?.owner;

    const isValidKRC721Record = () => {
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
      return (
        isValidKRC721Record() || isValidKaspaAddress() || genericErrorMessage
      );
    } catch (error) {
      console.error(error);
      return genericErrorMessage;
    }
  };

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

  return (
    <>
      <Header title="Transfer" onClose={onClose} onBack={onBack} />

      <div className="relative flex h-full flex-col gap-4">
        <div className="relative mx-auto max-h-28 max-w-48 rounded-xl bg-daintree-800">
          {!!data && (
            <img
              src={convertIPFStoHTTP(data.image)}
              alt="KRC721"
              className="m-auto max-h-28 max-w-48 rounded-xl"
            />
          )}
        </div>
        <div className="flex items-center justify-between">
          <label className="flex gap-1 text-base font-medium">
            <span>Transfer</span>
            <span className="text-icy-blue-400">{`${tick} #${tokenId}`}</span>
            <span>from</span>
          </label>
        </div>
        <div>
          <textarea
            disabled
            className="no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm text-daintree-400 placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0"
            value={account?.address}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-base font-medium">To ...</label>
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
            placeholder="Enter wallet address or KRC721"
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

        {/* Fee segment */}
        <div className="flex items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className={twMerge(
              "relative flex cursor-default items-center gap-2",
            )}
            disabled
          >
            <span>Fee</span>
            <i
              className={"hn hn-cog text-[16px] text-[#4B5563]"}
              data-tooltip-id="fee-tooltip"
              data-tooltip-content="KRC721 fees are handled automatically by Kastle."
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
              data-tooltip-content={`${Fee.Base} KAS for miner fees.`}
            ></i>

            <span>Estimated</span>
            <span>{Fee.Base} KAS</span>
          </div>
        </div>

        <div className="mt-auto">
          <button
            disabled={!isValid}
            onClick={onNext}
            className="mt-auto w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};
