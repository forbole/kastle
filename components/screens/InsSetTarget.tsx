import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import {
  WaitForTransactionReceiptTimeoutError,
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
import failImage from "@/assets/images/fail.png";

// INS only exists on Igra mainnet, so unlike the ERC-721 screens the chain is
// not a route parameter -- it is fixed and every client here is built for it.
export const INS_CHAIN_ID = numberToHex(igraMainnet.id);

export const insEthClient = createPublicClient({
  chain: igraMainnet,
  // Same opt-out as insRegistry: viem's http transport retries 3 times by
  // default, so a blackholed RPC turns one estimateGas into 4 attempts (~41s)
  // with nothing on screen but "Sending...". One attempt, bounded.
  transport: http(igraMainnet.rpcUrls.default.http[0], {
    retryCount: 0,
    timeout: 10_000,
  }),
});

// A receipt on Igra normally lands in a few seconds. This only bounds the wait
// so a stalled node cannot leave the screen spinning forever -- a timeout here
// means "unknown", never "failed".
export const RECEIPT_TIMEOUT_MS = 90_000;

export type ReceiptOutcome = "success" | "reverted" | "unknown";

/**
 * Wait for a receipt and say which of the three things actually happened.
 *
 * "unknown" is the one that matters: the transaction is already broadcast, so
 * it may still mine. Reporting it as failure tells the user nothing was sent
 * when the name is about to change hands; reporting it as success is worse.
 */
export async function awaitReceipt(
  hash: `0x${string}`,
): Promise<ReceiptOutcome> {
  try {
    const receipt = await insEthClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    return receipt.status === "success" ? "success" : "reverted";
  } catch (error) {
    if (!(error instanceof WaitForTransactionReceiptTimeoutError)) {
      // The wait itself broke (RPC down mid-poll). The transaction is out
      // there either way, so this is unknown for the same reason.
      console.error("INS receipt wait failed", error);
    }
    return "unknown";
  }
}

/** Explorer link for an INS-chain transaction, if the chain exposes one. */
export function igraExplorerTx(txId: string | undefined) {
  const base = insEthClient.chain?.blockExplorers?.default?.url;
  return base && txId ? `${base}/tx/${txId}` : undefined;
}

/** setTarget takes the bare label, not the token id. */
export function encodeSetTarget(label: string, target: `0x${string}`) {
  return encodeFunctionData({
    abi: TARGET_ABI,
    functionName: "setTarget",
    args: [label, target],
  });
}

const steps = [
  "details",
  "confirm",
  "broadcast",
  "success",
  "pending",
  "fail",
] as const;
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

  // Entry gate, not a live one. useInsOnChain fails closed and SWR revalidates
  // on reconnect, so keeping this live past the signature would let one failed
  // revalidation swap the broadcast/pending screen -- the only place the hash
  // is shown -- for "Could not verify this name on-chain."
  const gateActive = step === "details" || step === "confirm";

  const blocked = !gateActive
    ? undefined
    : !name
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
            onBack={onBack}
            setOutTxs={setOutTxs}
            setStep={setStep}
          />
        )}
        {step === "broadcast" && (
          // No auto-advance: onConfirm owns the step machine now and is still
          // waiting on the receipt. Broadcasting's own 1s timer would call the
          // update done a second after it was broadcast.
          <Broadcasting onSuccess={() => {}} />
        )}
        {step === "pending" && (
          <PendingStatus name={name!} txId={outTxs?.[0]} />
        )}
        {step === "success" && (
          <SuccessStatus
            chainId={INS_CHAIN_ID}
            transactionIds={outTxs}
            tokenName={name!}
            title=""
            description="This name now routes funds to the new address."
          />
        )}
        {step === "fail" && (
          <FailStatus
            chainId={INS_CHAIN_ID}
            transactionIds={outTxs}
            tokenName={name!}
            description="Kastle could not update where this name routes. Please try again."
          />
        )}
      </FormProvider>
    </div>
  );
}

/**
 * Broadcast, no receipt inside the timeout. Not success and not failure: the
 * transaction is out there and may still mine, so this screen says exactly that
 * and hands over the hash instead of guessing.
 */
function PendingStatus({
  name,
  txId,
}: {
  name: string;
  txId: string | undefined;
}) {
  const navigate = useNavigate();
  const explorer = igraExplorerTx(txId);

  return (
    <div className="flex h-full flex-col">
      <Header title="Still confirming" showPrevious={false} showClose={false} />
      <div className="mt-10 flex flex-1 flex-col justify-between gap-4">
        <div className="flex flex-col items-center gap-4">
          <img
            src={failImage}
            alt="Warning"
            className="mx-auto aspect-[686/240] w-full max-w-[343px]"
          />
          <div className="flex flex-col gap-2 px-4 text-center">
            <span className="text-xl font-semibold text-white">
              Kastle could not confirm this in time
            </span>
            <span className="text-sm text-gray-400">
              The routing update for {name} was sent and may still confirm.
              Check the transaction before sending another one.
            </span>
          </div>
          {explorer && (
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() => browser.tabs.create({ url: explorer })}
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                View in explorer
              </span>
              <i className="hn hn-external-link text-icy-blue-400"></i>
            </button>
          )}
        </div>

        <button
          onClick={() => navigate(`/ins/${name}`)}
          className="w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white"
        >
          Back to the name
        </button>
      </div>
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
    // No estimate yet is not a zero fee: quoting 0 next to a $0.00 fiat value
    // reads as a free transaction. Show nothing until the estimate lands.
    feeInKas: estimatedFee === undefined ? "—" : formatEther(estimatedFee),
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
      name={name}
      sender={currentTarget}
      action="Route"
      inputLabel="Route to ..."
      description={`Routing ${name} to another address means funds sent to it will be delivered there instead.`}
      feeInKas={feeInKas}
      onNext={onNext}
      onBack={onBack}
    />
  );
}

function SetTargetConfirm({
  name,
  onBack,
  setOutTxs,
  setStep,
}: {
  name: string;
  onBack: () => void;
  setOutTxs: (txs: string[]) => void;
  setStep: (step: Step) => void;
}) {
  const navigate = useNavigate();
  const sender = useEvmAddress();
  const signer = useEvmHotWalletSigner();
  const { refresh } = useInsOnChain(name);
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

    // Broadcast and confirmation are separate outcomes. Up to here nothing has
    // left the wallet, so a throw genuinely means nothing was sent.
    let txId: `0x${string}`;
    try {
      const gas = await insEthClient.estimateGas({
        account: sender,
        to: payload.to,
        data: payload.data,
      });

      txId = await sendEvmTransaction({
        ethClient: insEthClient,
        signer,
        sender,
        to: payload.to,
        gas,
        chainId: INS_CHAIN_ID,
        data: payload.data,
      });
    } catch (sendError) {
      console.error("INS setTarget broadcast failed", sendError);
      setStep("fail");
      setIsSigning(false);
      return;
    }

    // Past this line the hash exists, so every outcome below can show it.
    setOutTxs([txId]);
    setStep("broadcast");

    // This is the screen the half-done transfer sends people to in order to
    // un-point their name from a stranger, so it does not get to assert
    // success on a broadcast alone.
    const outcome = await awaitReceipt(txId);
    if (outcome === "success") {
      // The cached target is now stale, and the transfer flow reads it to
      // decide whether the routing leg is needed at all. Not awaited: nothing
      // below reads the result, and a rejected mutate would strand this
      // function on a screen with no back or close button.
      void refresh();
    } else if (outcome === "unknown") {
      // Broadcast but unconfirmed. If it mines later the cached target is
      // silently wrong, and needsSetTarget in the transfer flow reads exactly
      // that value to decide whether to re-point the name -- a stale match
      // there skips the routing leg and hands the name over routed elsewhere.
      // Drop the record so the next read refetches instead of trusting it.
      void refresh(undefined, { revalidate: false });
    }
    setStep(
      outcome === "success"
        ? "success"
        : outcome === "reverted"
          ? "fail"
          : "pending",
    );
    setIsSigning(false);
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
          // estimatedFee undefined means the balance check above did not run:
          // while the estimate is in flight both data and error are undefined,
          // so nothing gates the spend until one of them lands.
          disabled={
            isSigning ||
            isInsufficientFunds ||
            !!error ||
            estimatedFee === undefined
          }
        >
          Confirm
        </button>
      </div>
    </>
  );
}
