import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { encodeFunctionData, erc721Abi, formatEther } from "viem";
import Header from "@/components/GeneralHeader";
import InsAddressStep, {
  InsAddressFormData,
} from "@/components/ins/InsAddressStep";
import FailStatus from "@/components/send/evm/FailStatus";
import SuccessStatus from "@/components/send/evm/SuccessStatus";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import useFeeEstimate from "@/hooks/evm/useFeeEstimate";
import useInsOnChain, { InsOnChainRecord } from "@/hooks/ins/useInsOnChain";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { sendEvmTransaction } from "@/lib/ethereum/transaction";
import { toInsLabel } from "@/lib/ins/insRegistry";
import { formatCurrency, textEllipsis } from "@/lib/utils";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import carriageImage from "@/assets/images/carriage.png";
import signImage from "@/assets/images/sign.png";
import failImage from "@/assets/images/fail.png";
import {
  INS_CHAIN_ID,
  awaitReceipt,
  encodeSetTarget,
  igraExplorerTx,
  insEthClient,
} from "@/components/screens/InsSetTarget";

// The receipt wait is bounded in InsSetTarget (RECEIPT_TIMEOUT_MS) and its
// outcome is three-valued: a timeout means "unknown", never "failed", so tx2 is
// not fired on one and the user is not told nothing was sent.

type Phase =
  | { step: "details" }
  | { step: "confirm" }
  | { step: "routing" }
  | { step: "transferring"; setTargetTx?: string }
  | { step: "success"; txs: string[] }
  /**
   * tx1 is out and tx2 has not succeeded. `pending` says which leg is still
   * unresolved: "routing" means tx1 itself never got a receipt (it may still
   * mine and repoint the name), "transfer" means tx1 confirmed and tx2 is the
   * unresolved one, and undefined means tx1 confirmed and tx2 never left.
   */
  | {
      step: "partial";
      target: `0x${string}`;
      setTargetTx?: string;
      transferTx?: string;
      pending?: "routing" | "transfer";
    }
  /** Nothing is in flight. `txs` carries any hash that was broadcast first. */
  | { step: "fail"; txs: string[] };

export default function InsTransfer() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ step: "details" });

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

  // One gate for the whole flow. Both transactions are signed from this screen,
  // so blocking here is what keeps Ledger out of tx1 *and* tx2.
  //
  // It is an entry gate only. useInsOnChain fails closed and SWR revalidates on
  // reconnect, so a live gate would let one failed revalidation mid-sequence
  // replace the step machine -- Half done, the success hashes, all of it --
  // with "Could not verify this name on-chain."
  const gateActive = phase.step === "details" || phase.step === "confirm";

  const blocked = !gateActive
    ? undefined
    : !name
      ? "This name is missing from the address."
      : wallet?.type === "ledger"
        ? "Ledger doesn’t support transfer function currently."
        : isLoading
          ? "Verifying this name on-chain…"
          : !record
            ? (reason ?? "Could not verify this name on-chain. Try again.")
            : !isOwner
              ? "Only the owner of this name can transfer it."
              : undefined;

  if (blocked) {
    return (
      <div className="flex h-full flex-col p-4 text-white">
        <Header
          title="Transfer"
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
        {phase.step === "details" && (
          <TransferDetails
            name={name!}
            record={record!}
            onNext={() => setPhase({ step: "confirm" })}
            onBack={() => navigate(`/ins/${name}`)}
          />
        )}
        {phase.step === "confirm" && (
          <TransferConfirm
            name={name!}
            record={record!}
            setPhase={setPhase}
            onBack={() => setPhase({ step: "details" })}
          />
        )}
        {(phase.step === "routing" || phase.step === "transferring") && (
          <Progress
            twoTransactions={
              phase.step === "routing" || phase.setTargetTx !== undefined
            }
          />
        )}
        {phase.step === "success" && (
          <SuccessStatus
            chainId={INS_CHAIN_ID}
            transactionIds={phase.txs}
            tokenName={name!}
            title=""
          />
        )}
        {phase.step === "partial" && (
          <PartialFailure
            name={name!}
            setTargetTx={phase.setTargetTx}
            target={phase.target}
            pending={phase.pending}
            transferTx={phase.transferTx}
          />
        )}
        {phase.step === "fail" && (
          <FailStatus
            chainId={INS_CHAIN_ID}
            transactionIds={phase.txs}
            tokenName={name!}
          />
        )}
      </FormProvider>
    </div>
  );
}

/**
 * transferFrom does not touch the routing target, so a bare transfer leaves the
 * name delivering the new owner's incoming funds to the old owner. The flow
 * therefore points the target at the recipient first, and only then moves the
 * token -- once the token is gone the old owner can no longer call setTarget.
 */
function needsSetTarget(record: InsOnChainRecord, recipient: `0x${string}`) {
  // An unreadable target is not a matching target: re-point it rather than
  // silently skipping the step that makes the transfer safe.
  return record.target?.toLowerCase() !== recipient.toLowerCase();
}

function useTransferFees(record: InsOnChainRecord, name: string) {
  const sender = useEvmAddress();
  const { watch } = useFormContext<InsAddressFormData>();
  const recipient = watch().address;

  const transferPayload =
    recipient && sender
      ? {
          account: sender,
          to: record.registry,
          data: encodeFunctionData({
            abi: erc721Abi,
            functionName: "safeTransferFrom",
            args: [sender, recipient, record.tokenId],
          }),
        }
      : undefined;

  const setTargetPayload =
    recipient && sender && needsSetTarget(record, recipient)
      ? {
          account: sender,
          to: record.registry,
          data: encodeSetTarget(toInsLabel(name), recipient),
        }
      : undefined;

  const transfer = useFeeEstimate(INS_CHAIN_ID, transferPayload);
  const setTarget = useFeeEstimate(INS_CHAIN_ID, setTargetPayload);

  const total = (transfer.data ?? 0n) + (setTarget.data ?? 0n);

  // Having no setTarget leg is legitimate; having one that failed to estimate
  // is not. Left out, `total` silently collapses to the transfer fee alone and
  // the balance check clears a wallet that can only afford one of the two --
  // the exact half-done state the check exists to prevent.
  const setTargetUnpriced = !!setTargetPayload && setTarget.data === undefined;

  return {
    recipient,
    sender,
    transferPayload,
    setTargetPayload,
    error: transfer.error ?? setTarget.error,
    estimatedFee:
      transfer.data === undefined || setTargetUnpriced ? undefined : total,
    feeInKas: formatEther(total),
  };
}

function TransferDetails({
  name,
  record,
  onNext,
  onBack,
}: {
  name: string;
  record: InsOnChainRecord;
  onNext: () => void;
  onBack: () => void;
}) {
  const sender = useEvmAddress();
  const { feeInKas } = useTransferFees(record, name);

  return (
    <InsAddressStep
      title="Transfer"
      name={name}
      sender={sender}
      action="Transfer"
      feeInKas={feeInKas}
      extraValidate={(address) =>
        sender && address.toLowerCase() === sender.toLowerCase()
          ? "You cannot send this name to yourself"
          : undefined
      }
      checkContractRecipient
      onNext={onNext}
      onBack={onBack}
    />
  );
}

function TransferConfirm({
  name,
  record,
  setPhase,
  onBack,
}: {
  name: string;
  record: InsOnChainRecord;
  setPhase: (phase: Phase) => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const signer = useEvmHotWalletSigner();
  const { refresh } = useInsOnChain(name);
  const [isSigning, setIsSigning] = useState(false);
  const [preflightError, setPreflightError] = useState<string>();

  const {
    recipient,
    sender,
    transferPayload,
    setTargetPayload,
    error,
    estimatedFee,
    feeInKas,
  } = useTransferFees(record, name);

  const { data: balanceData } = useEvmKasBalance(INS_CHAIN_ID);
  const kaspaPrice = useKaspaPrice().kaspaPrice;
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    estimatedFee ? parseFloat(feeInKas) * kaspaPrice : 0,
  );

  const isInsufficientFunds =
    estimatedFee !== undefined &&
    balanceData !== undefined &&
    (balanceData.rawBalance < estimatedFee || balanceData.rawBalance === 0n);

  // Broadcast only. Confirmation is awaited separately by the caller: folding
  // the two together made a receipt timeout indistinguishable from a send that
  // never happened, and only one of those leaves a transaction in flight.
  const broadcast = async (payload: {
    to: `0x${string}`;
    data: `0x${string}`;
  }) => {
    const gas = await insEthClient.estimateGas({
      account: sender!,
      to: payload.to,
      data: payload.data,
    });

    return sendEvmTransaction({
      ethClient: insEthClient,
      signer: signer!,
      sender: sender!,
      to: payload.to,
      gas,
      chainId: INS_CHAIN_ID,
      data: payload.data,
    });
  };

  const onConfirm = async () => {
    if (isSigning || !recipient || !sender || !signer || !transferPayload)
      return;
    setIsSigning(true);
    setPreflightError(undefined);

    // Estimate the transfer before signing anything. setTarget does not affect
    // transferability, so an estimate taken now still holds after tx1 -- and if
    // the transfer cannot succeed, neither transaction is sent and the name is
    // left exactly as it was.
    try {
      await insEthClient.estimateGas({
        account: sender,
        to: transferPayload.to,
        data: transferPayload.data,
      });
    } catch (estimateError) {
      console.error("INS transfer pre-flight failed", estimateError);
      setPreflightError(
        "This transfer would fail on-chain, so nothing was sent. Check the recipient address.",
      );
      setIsSigning(false);
      return;
    }

    let setTargetTx: `0x${string}` | undefined;
    if (setTargetPayload) {
      setPhase({ step: "routing" });

      try {
        setTargetTx = await broadcast(setTargetPayload);
      } catch (broadcastError) {
        // Nothing left the wallet, so tx2 is not attempted and nothing moved.
        console.error("INS setTarget broadcast failed", broadcastError);
        setPhase({ step: "fail", txs: [] });
        setIsSigning(false);
        return;
      }

      const routingOutcome = await awaitReceipt(setTargetTx);
      if (routingOutcome !== "success") {
        if (routingOutcome === "reverted") {
          setPhase({ step: "fail", txs: [setTargetTx] });
        } else {
          // Broadcast but unconfirmed. It may still mine, and then the name
          // routes to the recipient while it is still ours -- which is the
          // half-done state, not "nothing was sent". The hash goes with it.
          setPhase({
            step: "partial",
            setTargetTx,
            target: recipient,
            pending: "routing",
          });
        }
        setIsSigning(false);
        return;
      }

      // Confirmed: the cached target is stale from here on, and a retry reads
      // it to decide whether this leg is needed at all.
      await refresh();
    }

    setPhase({ step: "transferring", setTargetTx });

    let transferTx: `0x${string}`;
    try {
      transferTx = await broadcast(transferPayload);
    } catch (broadcastError) {
      console.error("INS transfer broadcast failed", broadcastError);
      setPhase(
        setTargetTx
          ? { step: "partial", setTargetTx, target: recipient }
          : { step: "fail", txs: [] },
      );
      setIsSigning(false);
      return;
    }

    const transferOutcome = await awaitReceipt(transferTx);
    if (transferOutcome === "success") {
      // Confirmed: the cached owner is now stale, same as the setTarget leg
      // above.
      await refresh();
      setPhase({
        step: "success",
        txs: setTargetTx ? [setTargetTx, transferTx] : [transferTx],
      });
    } else if (transferOutcome === "reverted" && !setTargetTx) {
      setPhase({ step: "fail", txs: [transferTx] });
    } else {
      setPhase({
        step: "partial",
        setTargetTx,
        target: recipient,
        transferTx,
        pending: transferOutcome === "unknown" ? "transfer" : undefined,
      });
    }
    setIsSigning(false);
  };

  return (
    <>
      <Header
        title="Confirm"
        onClose={() => navigate("/dashboard")}
        onBack={onBack}
      />

      {/* The two-transaction copy makes this screen taller than the 600px
          popup. min-h-0 + overflow-y-auto on the content, button pinned
          outside it -- without min-h-0 the column grows to its content and the
          Confirm button lands below the fold with no scrollbar to reach it. */}
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <img
            alt="castle"
            className="aspect-[686/240] w-full max-w-[343px] self-center"
            src={signImage}
          />

          <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
            <div className="flex gap-1 text-base font-medium">
              <span>Transfer</span>
              <span className="text-icy-blue-400">
                {textEllipsis(name, 20)}
              </span>
              <span>to</span>
            </div>
            <span className="break-all text-xs text-daintree-400">
              {recipient}
            </span>
          </div>

          {/* The last screen before a signature, and with a hot wallet both
            signatures happen silently under "Sending...". One line, so nobody
            reaches the second one without having been told it was coming. */}
          {setTargetPayload && (
            <span className="px-1 text-xs text-daintree-400">
              This takes two transactions: one to point {textEllipsis(name, 20)}{" "}
              at the new owner, one to hand over the name itself.
            </span>
          )}

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
        </div>

        <div className="flex shrink-0 flex-col gap-2 pt-2">
          {isInsufficientFunds && (
            <div className="text-center text-sm text-red-500">
              Insufficient funds to cover transaction fees.
            </div>
          )}
          {!!error && (
            <div className="text-center text-sm text-red-500">
              Failed to simulate transaction and estimate fee. Please try again.
            </div>
          )}
          {preflightError && (
            <div className="text-center text-sm text-red-500">
              {preflightError}
            </div>
          )}

          <button
            onClick={onConfirm}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:cursor-not-allowed disabled:bg-icy-blue-800"
            disabled={isSigning || isInsufficientFunds || !!error}
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
}

function Progress({ twoTransactions }: { twoTransactions: boolean }) {
  return (
    <>
      <Header title="Sending" showPrevious={false} showClose={false} />
      <div className="mt-10 flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="aspect-[686/240] w-full max-w-[343px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Sending...
        </span>
        {/* Safety instruction, not decoration: closing the popup between the
          two transactions is what strands the name routing to the recipient
          while it is still the sender's. */}
        <span className="px-10 text-center text-sm text-daintree-400">
          {twoTransactions
            ? "Keep this window open until both transactions confirm."
            : "Keep this window open until the transaction confirms."}
        </span>
      </div>
    </>
  );
}

/**
 * The in-between screen: something is broadcast and the transfer did not
 * complete. `pending` names the leg still unresolved, because "may still
 * confirm" and "did not go through" call for different actions.
 */
function PartialFailure({
  name,
  setTargetTx,
  transferTx,
  target,
  pending,
}: {
  name: string;
  setTargetTx: string | undefined;
  transferTx: string | undefined;
  target: `0x${string}`;
  pending: "routing" | "transfer" | undefined;
}) {
  const navigate = useNavigate();

  const links = (
    [
      ["View routing transaction", setTargetTx],
      ["View transfer transaction", transferTx],
    ] as const
  ).flatMap(([label, txId]) => {
    const url = igraExplorerTx(txId);
    return url ? [{ label, url }] : [];
  });

  return (
    <div className="flex h-full flex-col">
      <Header
        title={pending ? "Still confirming" : "Half done"}
        showPrevious={false}
        showClose={false}
      />
      <div className="mt-10 flex flex-1 flex-col justify-between gap-4">
        <div className="flex flex-col items-center gap-4">
          <img
            src={failImage}
            alt="Warning"
            className="mx-auto aspect-[686/240] w-full max-w-[343px]"
          />
          <div className="flex flex-col gap-2 px-4 text-center">
            <span
              className={`text-xl font-semibold ${pending ? "text-white" : "text-red-500"}`}
            >
              {pending
                ? "Kastle could not confirm this in time"
                : "The transfer did not go through"}
            </span>
            <span className="text-sm text-gray-400">
              {pending === "routing" ? (
                <>
                  The transaction pointing {name} at {target} was sent and may
                  still confirm. If it does, {name} routes funds there while you
                  still own it. Check the transaction below, then point the
                  routing back at your own address if it went through.
                </>
              ) : pending === "transfer" ? (
                <>
                  {name} routes funds to {target}. The transfer itself was sent
                  and may still confirm — check the transaction below before
                  trying again, and point the routing back at your own address
                  if it did not go through.
                </>
              ) : (
                <>
                  You still own {name}, but it now routes funds to {target}.
                  Point it back at your own address before anyone sends to it,
                  or try the transfer again.
                </>
              )}
            </span>
          </div>
          {links.map(({ label, url }) => (
            <button
              key={url}
              type="button"
              className="flex items-center gap-2"
              onClick={() => browser.tabs.create({ url })}
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                {label}
              </span>
              <i className="hn hn-external-link text-icy-blue-400"></i>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => navigate(`/ins/${name}/set-target`)}
            className="w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white"
          >
            Fix the routing target
          </button>
          <button
            onClick={() => navigate(`/ins/${name}`)}
            className="w-full rounded-full border border-daintree-700 py-4 text-base font-medium text-white"
          >
            Back to the name
          </button>
        </div>
      </div>
    </div>
  );
}
