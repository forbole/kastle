import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  http,
  numberToHex,
} from "viem";
import Header from "@/components/GeneralHeader";
import InsAddressStep, {
  InsAddressFormData,
} from "@/components/ins/InsAddressStep";
import { Broadcasting } from "@/components/send/Broadcasting";
import FailStatus from "@/components/send/evm/FailStatus";
import SuccessStatus from "@/components/send/evm/SuccessStatus";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import useFeeEstimate from "@/hooks/evm/useFeeEstimate";
import useInsOnChain from "@/hooks/ins/useInsOnChain";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { sendEvmTransaction } from "@/lib/ethereum/transaction";
import { TARGET_ABI, toInsLabel } from "@/lib/ins/insRegistry";
import { igraMainnet } from "@/lib/layer2";
import { formatCurrency, textEllipsis } from "@/lib/utils";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import signImage from "@/assets/images/sign.png";

// INS only exists on Igra mainnet, so unlike the ERC-721 screens the chain is
// not a route parameter -- it is fixed and every client here is built for it.
export const INS_CHAIN_ID = numberToHex(igraMainnet.id);

export const insEthClient = createPublicClient({
  chain: igraMainnet,
  transport: http(igraMainnet.rpcUrls.default.http[0]),
});

/** setTarget takes the bare label, not the token id. */
export function encodeSetTarget(label: string, target: `0x${string}`) {
  return encodeFunctionData({
    abi: TARGET_ABI,
    functionName: "setTarget",
    args: [label, target],
  });
}

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;
type Step = (typeof steps)[number];

export default function InsSetTarget() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");
  const [outTxs, setOutTxs] = useState<string[]>();

  const form = useForm<InsAddressFormData>({
    defaultValues: {},
    mode: "onChange",
  });

  const { record, reason, isLoading } = useInsOnChain(name);
  const evmAddress = useEvmAddress();
  const { wallet } = useWalletManager();

  const isOwner =
    !!record &&
    !!evmAddress &&
    record.owner.toLowerCase() === evmAddress.toLowerCase();

  const blocked = !name
    ? "This name is missing from the address."
    : wallet?.type === "ledger"
      ? "Ledger doesn’t support this function currently."
      : isLoading
        ? "Verifying this name on-chain…"
        : !record
          ? (reason ?? "Could not verify this name on-chain. Try again.")
          : !isOwner
            ? "Only the owner of this name can change where it routes."
            : undefined;

  const onBack = () => {
    const idx = steps.indexOf(step);
    if (idx === 0) {
      navigate(`/ins/${name}`);
      return;
    }
    setStep(steps[idx - 1]);
  };

  if (blocked) {
    return (
      <div className="flex h-full flex-col p-4 text-white">
        <Header
          title="Routing target"
          onClose={() => navigate("/dashboard")}
          onBack={() => navigate(`/ins/${name}`)}
        />
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-daintree-400">
          {blocked}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && (
          <SetTargetDetails
            name={name!}
            currentTarget={record!.target}
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
        {step === "confirm" && (
          <SetTargetConfirm
            name={name!}
            onNext={() => setStep("broadcast")}
            onBack={onBack}
            setOutTxs={setOutTxs}
            onFail={() => setStep("fail")}
          />
        )}
        {step === "broadcast" && (
          <Broadcasting onSuccess={() => setStep("success")} />
        )}
        {step === "success" && (
          <SuccessStatus
            chainId={INS_CHAIN_ID}
            transactionIds={outTxs}
            tokenName={`${name} routing update`}
          />
        )}
        {step === "fail" && (
          <FailStatus
            chainId={INS_CHAIN_ID}
            transactionIds={outTxs}
            tokenName={`${name} routing update`}
          />
        )}
      </FormProvider>
    </div>
  );
}

/**
 * Fee estimate for a setTarget from `sender`. Shared by the details and confirm
 * steps so both quote the same number.
 */
function useSetTargetFee(name: string, target: `0x${string}` | undefined) {
  const sender = useEvmAddress();
  const { record } = useInsOnChain(name);

  const payload =
    target && sender && record
      ? {
          account: sender,
          to: record.registry,
          data: encodeSetTarget(toInsLabel(name), target),
        }
      : undefined;

  const { data: estimatedFee, error } = useFeeEstimate(INS_CHAIN_ID, payload);
  return {
    payload,
    estimatedFee,
    error,
    feeInKas: formatEther(estimatedFee ?? 0n),
  };
}

function SetTargetDetails({
  name,
  currentTarget,
  onNext,
  onBack,
}: {
  name: string;
  currentTarget: `0x${string}` | undefined;
  onNext: () => void;
  onBack: () => void;
}) {
  const { watch } = useFormContext<InsAddressFormData>();
  const { feeInKas } = useSetTargetFee(name, watch().address);

  return (
    <InsAddressStep
      title="Routing target"
      inputLabel="Route to ..."
      feeInKas={feeInKas}
      onNext={onNext}
      onBack={onBack}
      intro={
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4 text-sm">
          <span className="text-base font-medium text-white">
            {textEllipsis(name, 20)}
          </span>
          <span className="text-daintree-400">
            The routing target is where anyone sending to this name has their
            funds delivered. Owning the name and routing it are separate: this
            changes only the routing.
          </span>
          <span className="break-all text-xs text-daintree-400">
            {currentTarget
              ? `Currently routes to ${currentTarget}`
              : "Kastle could not read the current target."}
          </span>
        </div>
      }
    />
  );
}

function SetTargetConfirm({
  name,
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: {
  name: string;
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (txs: string[]) => void;
  onFail: () => void;
}) {
  const navigate = useNavigate();
  const sender = useEvmAddress();
  const signer = useEvmHotWalletSigner();
  const [isSigning, setIsSigning] = useState(false);
  const { watch } = useFormContext<InsAddressFormData>();
  const { address } = watch();

  const { payload, estimatedFee, error, feeInKas } = useSetTargetFee(
    name,
    address,
  );
  const { data: balanceData } = useEvmKasBalance(INS_CHAIN_ID);
  const kaspaPrice = useKaspaPrice().kaspaPrice;
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    estimatedFee ? parseFloat(feeInKas) * kaspaPrice : 0,
  );

  const isInsufficientFunds =
    estimatedFee !== undefined &&
    balanceData !== undefined &&
    (balanceData.rawBalance < estimatedFee || balanceData.rawBalance === 0n);

  const onConfirm = async () => {
    if (isSigning || !payload || !sender || !signer) return;
    setIsSigning(true);

    try {
      const gas = await insEthClient.estimateGas({
        account: sender,
        to: payload.to,
        data: payload.data,
      });

      const txId = await sendEvmTransaction({
        ethClient: insEthClient,
        signer,
        sender,
        to: payload.to,
        gas,
        chainId: INS_CHAIN_ID,
        data: payload.data,
      });

      setOutTxs([txId]);
      onNext();
    } catch (sendError) {
      console.error("INS setTarget failed", sendError);
      onFail();
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <>
      <Header
        title="Confirm"
        onClose={() => navigate("/dashboard")}
        onBack={onBack}
      />

      <div className="flex h-full flex-col gap-2">
        <img
          alt="castle"
          className="aspect-[686/240] w-full max-w-[343px] self-center"
          src={signImage}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <div className="flex gap-1 text-base font-medium">
            <span>Route</span>
            <span className="text-icy-blue-400">{textEllipsis(name, 20)}</span>
            <span>to</span>
          </div>
          <span className="break-all text-xs text-daintree-400">{address}</span>
        </div>

        <div className="flex justify-between gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">Fee</span>
          <div className="flex flex-col items-end break-all">
            <span className="text-base font-medium text-white">
              {feeInKas} KAS
            </span>
            <span className="text-xs text-daintree-400">
              {formatCurrency(feesCurrency, feesCurrencyCode)}
            </span>
          </div>
        </div>

        <div className="mt-auto">
          {isInsufficientFunds && (
            <div className="text-center text-sm text-red-500">
              Insufficient funds to cover transaction fee.
            </div>
          )}
          {!!error && (
            <div className="text-center text-sm text-red-500">
              Failed to simulate transaction and estimate fee. Please try again.
            </div>
          )}
        </div>

        <button
          onClick={onConfirm}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:cursor-not-allowed disabled:bg-icy-blue-800"
          disabled={isSigning || isInsufficientFunds || !!error}
        >
          Confirm
        </button>
      </div>
    </>
  );
}
