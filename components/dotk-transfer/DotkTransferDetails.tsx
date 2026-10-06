import { useFormContext } from "react-hook-form";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { useBoolean } from "usehooks-ts";
import { Tooltip } from "react-tooltip";
import Header from "@/components/GeneralHeader.tsx";
import spinner from "@/assets/images/spinner.svg";
import RecentAddresses from "@/components/send/RecentAddresses.tsx";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import { useResolveRecipient } from "@/hooks/names/useResolveRecipient";
import { makeRegistrar } from "@/lib/dotk/registrar";
import { formatToken } from "@/lib/utils.ts";
import type {
  DotkTransferFormData,
  DotkTransferPlan,
} from "@/components/dotk-transfer/DotkTransfer.tsx";

type DotkTransferDetailsProps = {
  planned: DotkTransferPlan | undefined;
  setPlanned: (value: DotkTransferPlan | undefined) => void;
  onNext: () => void;
  onBack?: () => void;
};

export default function DotkTransferDetails({
  planned,
  setPlanned,
  onNext,
  onBack,
}: DotkTransferDetailsProps) {
  const navigate = useNavigate();
  const { account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const walletSigner = useKaspaHotWalletSigner();
  const resolveRecipient = useResolveRecipient();
  const resolutionSeq = useRef(0);
  const {
    register,
    watch,
    setValue,
    setError,
    formState: { isValid, errors, validatingFields },
  } = useFormContext<DotkTransferFormData>();
  const { name, userInput, address, domain } = watch();
  const [planError, setPlanError] = useState<string>();
  const [isPlanning, setIsPlanning] = useState(false);

  const {
    value: isRecentAddressShown,
    setFalse: hideRecentAddress,
    setTrue: showRecentAddress,
  } = useBoolean(false);
  const { value: isAddressFieldFocused, setValue: setAddressFieldFocused } =
    useBoolean(false);

  const onClose = () => navigate("/dashboard");

  const addressValidator = async (value: string | undefined) => {
    const genericErrorMessage = "Invalid address or KNS domain";
    const seq = ++resolutionSeq.current;
    if (!value) return false;

    try {
      const resolved = await resolveRecipient(value);
      // A newer keystroke superseded this lookup -- let that one own the form.
      if (seq !== resolutionSeq.current) return genericErrorMessage;

      if (!resolved.address) {
        setValue("address", undefined);
        setValue("domain", undefined);
        return resolved.fault ?? genericErrorMessage;
      }

      // A transfer to oneself is a records save, a separate flow.
      if (resolved.address === account?.address) {
        setValue("address", undefined);
        setValue("domain", undefined);
        return "You cannot transfer a name to yourself";
      }

      setValue("address", resolved.address);
      setValue("domain", resolved.domain);
      if (resolved.domain) setError("userInput", { message: undefined });
      return true;
    } catch (error) {
      console.error(error);
      return genericErrorMessage;
    }
  };

  // Plan on every resolved recipient: the fee and the cards come from sdk-tx's
  // own measurement, never from an estimate. One Registrar per operation.
  useEffect(() => {
    setPlanned(undefined);
    setPlanError(undefined);
    if (!address || !account?.address || !rpcClient || !networkId) return;
    if (!walletSigner) return;

    let cancelled = false;
    setIsPlanning(true);
    const registrar = makeRegistrar({
      networkId,
      rpcClient,
      walletSigner,
      address: account.address,
    });
    registrar
      .planTransfer(name, address)
      .then((plan) => {
        if (!cancelled) setPlanned({ registrar, plan });
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) {
          setPlanError(
            e instanceof Error ? e.message : "Couldn’t plan this transfer",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsPlanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, name, networkId, account?.address]);

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

  const plan = planned?.plan;
  const feeKas = plan ? formatToken(Number(plan.fee) / 1e8, 3) : undefined;

  return (
    <>
      <Header title="Transfer" onClose={onClose} onBack={onBack} />

      <div className="relative flex h-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <label className="flex gap-1 text-base font-medium">
            <span>Transfer</span>
            <span className="text-icy-blue-400">{name}</span>
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
        <div className="relative">
          <textarea
            onFocus={() => setAddressFieldFocused(true)}
            {...register("userInput", {
              validate: addressValidator,
              onBlur: () => setAddressFieldFocused(false),
            })}
            className={twMerge(
              "no-scrollbar w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 pe-12 text-sm placeholder-daintree-200 ring-0 hover:placeholder-daintree-50 focus:border-daintree-700 focus:ring-0",
              (errors.userInput || planError) &&
                "ring ring-red-500/25 focus:ring focus:ring-red-500/25",
            )}
            placeholder="Enter wallet address or name"
          />

          <div className="pointer-events-none absolute end-0 top-10 flex h-16 items-center pe-3">
            {(validatingFields.address || isPlanning) && (
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
          {planError && (
            <span className="inline-block text-sm text-red-500">
              {planError}
            </span>
          )}
          <RecentAddresses
            isShown={isRecentAddressShown}
            hideAddressSelect={hideRecentAddress}
          />
        </div>

        {/* Subnames end with the transfer: the seller reads them before signing. */}
        {!!plan?.cards.subnamesDropped.length && (
          <div className="flex flex-col gap-1 rounded-lg border border-red-500/40 bg-daintree-800 p-3 text-sm">
            <span className="font-medium text-red-500">
              {plan.cards.subnamesDropped.length} subname
              {plan.cards.subnamesDropped.length > 1 ? "s" : ""} will end
            </span>
            {plan.cards.subnamesDropped.map((s) => (
              <span
                key={s.label}
                className="break-all text-xs text-daintree-400"
              >
                {s.label}
                {s.address ? ` → ${s.address}` : ""}
              </span>
            ))}
          </div>
        )}

        {/* Fee segment */}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Fee</span>
          <div className="flex items-center gap-2">
            <span>{feeKas ? `${feeKas} KAS` : "—"}</span>
          </div>
        </div>
        {plan && plan.cards.swept > 0 && (
          <span className="text-xs text-daintree-400">
            Reclaims {plan.cards.swept} old record card
            {plan.cards.swept > 1 ? "s" : ""} in the same transaction.
          </span>
        )}

        <div className="mt-auto">
          <button
            disabled={!isValid || !plan}
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
