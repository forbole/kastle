import { useFormContext } from "react-hook-form";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader.tsx";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { Address, PublicKey } from "@/wasm/core/kaspa";
import { twMerge } from "tailwind-merge";
import { useBoolean } from "usehooks-ts";
import RecentAddresses from "@/components/send/RecentAddresses.tsx";
import spinner from "@/assets/images/spinner.svg";
import { Tooltip } from "react-tooltip";
import { KRC721TransferFormData } from "@/components/screens/KRC721Transfer.tsx";
import { buildKrc721TransferScript } from "@/lib/krc721";
import { useKasFeeEstimate } from "@/hooks/useKasFeeEstimate";
import { useKns } from "@/hooks/kns/useKns";
import { convertIPFStoHTTP, formatToken } from "@/lib/utils.ts";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";
import { useKRC721Details } from "@/hooks/krc721/useKRC721";
import FeeSegment from "../nft-transfer/FeeSegment";

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

  const scriptHex = useMemo(() => {
    const pubKeyHex = account?.publicKeys?.[0];
    if (!pubKeyHex || !tick || !tokenId || !address) return undefined;
    try {
      return buildKrc721TransferScript(new PublicKey(pubKeyHex), {
        tick,
        tokenId,
        to: address,
      }).toString();
    } catch {
      return undefined;
    }
  }, [account?.publicKeys?.[0], tick, tokenId, address]);

  const { fee: commitFee } = useKasFeeEstimate();
  const { fee: revealFee } = useKasFeeEstimate(
    scriptHex ? { scriptsHexes: [scriptHex] } : undefined,
  );
  const estimatedFeeKas = formatToken(
    ((commitFee ?? 0) + (revealFee ?? 0)) / 1e8,
    3,
  );

  const {
    value: isRecentAddressShown,
    setFalse: hideRecentAddress,
    setTrue: showRecentAddress,
  } = useBoolean(false);

  const { data } = useKRC721Details(tick, tokenId);

  const { value: isAddressFieldFocused, setValue: setAddressFieldFocused } =
    useBoolean(false);
  const kasBalance = useKaspaBalance(account?.address) ?? 0;
  const currentBalance = kasBalance;

  const onClose = () => navigate("/dashboard");

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address or KRC721 domain";
    if (!value) return false;

    if (currentBalance < ((commitFee ?? 0) + (revealFee ?? 0)) / 1e8) {
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
              backgroundColor: "#203C49",
              fontSize: "12px",
              fontWeight: 600,
              padding: "2px 8px",
            }}
            opacity={1}
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

        <FeeSegment
          feeTooltipText="KRC721 fees are handled automatically by Kastle."
          estimatedFeeTooltipText={`~${estimatedFeeKas} KAS for miner fees.`}
          estimatedFee={estimatedFeeKas}
        />

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
