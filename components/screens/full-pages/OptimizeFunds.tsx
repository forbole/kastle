import { useLocation, useNavigate } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import Header from "@/components/GeneralHeader.tsx";
import carriageImage from "@/assets/images/carriage.png";
import { IUtxoEntry, sompiToKaspaString, version } from "@/wasm/core/kaspa";
import {
  assertSignerOwnsAddress,
  buildRoundReport,
  classifyConsolidation,
  ConsolidationPlan,
  ConsolidationProgress,
  ConsolidationResult,
  EntryScreen,
  loadLiveEntries,
  planConsolidationRound,
  runConsolidation,
  reportError,
  scrubReportText,
  SignerMismatchError,
  SignerUnavailableError,
} from "@/lib/consolidate";
import { useUtxoEntries } from "@/hooks/useKasFeeEstimate";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";

/** One sentence per reason entries stay out of the round. */
export function describeSkipped({
  skippedCovenant,
  skippedImmature,
}: {
  skippedCovenant: number;
  skippedImmature: number;
}): string[] {
  const lines: string[] = [];
  if (skippedCovenant > 0) {
    lines.push(
      skippedCovenant === 1
        ? "1 UTXO carries token state or belongs to another key and stays as it is."
        : `${skippedCovenant.toLocaleString()} UTXOs carry token state or belong to another key and stay as they are.`,
    );
  }
  if (skippedImmature > 0) {
    lines.push(
      skippedImmature === 1
        ? "1 UTXO is a coinbase payout that is not spendable yet and stays out of this round."
        : `${skippedImmature.toLocaleString()} UTXOs are coinbase payouts that are not spendable yet and stay out of this round.`,
    );
  }
  return lines;
}

export const MATURITY_UNKNOWN_NOTE =
  "Coinbase maturity could not be checked, so the node may refuse the round if it includes a payout that is not spendable yet.";

/** Why there is no round to run, true whether or not entries were dropped. */
export function describeNoPlan(screen: EntryScreen | undefined): string {
  const skipped = screen ? describeSkipped(screen) : [];
  if (!screen || skipped.length === 0) {
    return "Your funds already fit in a single transaction.";
  }
  const head =
    screen.spendable === 0
      ? "No UTXO can be optimized."
      : "The UTXOs this round can spend already fit in a single transaction.";
  return [head, ...skipped].join(" ");
}

export function OptimizeFundsConfirm({
  entriesBefore,
  entriesAfter,
  transactionCount,
  feeSompi,
  isLedger,
  canConfirm,
  onConfirm,
  skippedCovenant = 0,
  skippedImmature = 0,
  maturityUnknown = false,
}: {
  skippedCovenant?: number;
  skippedImmature?: number;
  maturityUnknown?: boolean;
  entriesBefore: number;
  entriesAfter: number;
  transactionCount: number;
  feeSompi: bigint;
  isLedger: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="bg-white/1 flex flex-col gap-4 rounded-lg border border-daintree-700 p-6 text-base">
        <div className="flex items-center justify-between">
          <span className="text-daintree-400">Entries before</span>
          <span className="font-semibold">
            {entriesBefore.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-daintree-400">Entries after</span>
          <span className="font-semibold">{entriesAfter.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-daintree-400">Transactions</span>
          <span className="font-semibold">
            {transactionCount.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-daintree-400">Network fee</span>
          <span className="font-semibold">
            {sompiToKaspaString(feeSompi)} KAS
          </span>
        </div>
        {describeSkipped({ skippedCovenant, skippedImmature }).map((line) => (
          <span key={line} className="text-daintree-400">
            {line}
          </span>
        ))}
        {maturityUnknown && (
          <span className="text-daintree-400">{MATURITY_UNKNOWN_NOTE}</span>
        )}
        {isLedger && (
          <span className="font-semibold text-[#14B8A6]">
            {`${transactionCount} transactions · ${transactionCount} approvals on your Ledger`}
          </span>
        )}
      </div>
      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          onClick={onConfirm}
          disabled={!canConfirm}
          className="flex w-full items-center justify-center rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
        >
          Optimize
        </button>
        <span className="text-daintree-400">
          Your funds stay in this account
        </span>
      </div>
    </>
  );
}

export default function OptimizeFunds() {
  const navigate = useNavigate();
  // a retry from the incomplete screen carries the inputs it already spent
  const spentOutpoints: string[] | undefined =
    useLocation().state?.spentOutpoints;
  const { wallet, account } = useWalletManager();
  const { rpcClient, networkId, isConnected } = useRpcClientStateful();
  const isLedger = wallet?.type === "ledger";
  const hotWalletSigner = useKaspaHotWalletSigner();
  const ledgerSigner = useKaspaLedgerSigner();
  const walletSigner = isLedger ? ledgerSigner : hotWalletSigner;
  const { mutate: revalidateEntries } = useUtxoEntries(account?.address);

  const [entries, setEntries] = useState<IUtxoEntry[]>();
  const [plan, setPlan] = useState<ConsolidationPlan | null>();
  const [planError, setPlanError] = useState<string>();
  const [screened, setScreened] = useState<EntryScreen>();
  const [isRunning, setIsRunningState] = useState(false);
  // read by the address-reset effect, which must not wipe a running round
  const isRunningRef = useRef(false);
  const setIsRunning = (running: boolean) => {
    isRunningRef.current = running;
    setIsRunningState(running);
  };
  const [progress, setProgress] = useState<ConsolidationProgress>({
    submitted: 0,
    rejected: 0,
    feePaid: 0n,
    spentOutpoints: [],
  });
  const [cancelledEarly, setCancelledEarly] = useState<ConsolidationResult>();
  const [isCanceledUi, setIsCanceledUi] = useState(false);
  const isCanceled = useRef(false);
  const isPlanning = useRef(false);
  // bumped on every account switch: a planning run from an older address
  // finishing late must not overwrite the new one
  const planRun = useRef(0);
  const plannedAddress = useRef(account?.address);
  const hasSigner = !!walletSigner;

  // A plan is bound to the address it was planned for: an account switch
  // drops it and plans again for the new address. Declared before the
  // planning effect so both run, in this order, in the same commit.
  // A running round is left alone: wiping it would read "/0" and re-planning
  // would send a Ledger getPublicKey mid-signing. runConsolidation already
  // checked the signer against the plan's address before signing.
  useEffect(() => {
    if (isRunningRef.current) return;
    if (plannedAddress.current === account?.address) return;
    plannedAddress.current = account?.address;
    planRun.current++;
    isPlanning.current = false;
    setPlan(undefined);
    setPlanError(undefined);
    setScreened(undefined);
    setEntries(undefined);
  }, [account?.address]);

  // Planned once per address, from a revalidation: SWR's cached set predates
  // any earlier round, and the round must spend the entries the confirm step
  // showed, not whatever 5 s revalidation brings back.
  useEffect(() => {
    if (!isConnected || !rpcClient || !account?.address || !networkId) return;
    // the hot signer exists once the wallet loads: wait for it rather than
    // plan unchecked. A Ledger signer needs the device, so plan without it;
    // runConsolidation checks ownership before anything is signed.
    if (!isLedger && !walletSigner) return;
    if (isPlanning.current) return;
    isPlanning.current = true;
    const run = planRun.current;
    const address = account.address;
    const fail = (error: unknown) => {
      if (run !== planRun.current) return;
      const isSignerError =
        error instanceof SignerMismatchError ||
        error instanceof SignerUnavailableError;
      // a WASM or node error can carry an address; console breadcrumbs reach
      // Sentry, so both copies are scrubbed the way the report is
      console.error(isSignerError ? error : scrubReportText(String(error)));
      // planError first: a null plan without it reads "already fit"
      setPlanError(
        isSignerError ? error.message : scrubReportText(String(error)),
      );
      setPlan(null);
    };
    (walletSigner
      ? assertSignerOwnsAddress(walletSigner, address)
      : Promise.resolve()
    )
      .then(async () => {
        const live = await loadLiveEntries(
          () => revalidateEntries(),
          spentOutpoints,
        );
        const { plan: planned, screen } = await planConsolidationRound({
          entries: live,
          changeAddress: address,
          networkId,
          rpcClient,
        });
        if (run !== planRun.current) return;
        setEntries(live);
        setScreened(screen);
        setPlan(planned ?? null);
      })
      .catch(fail);
  }, [isConnected, rpcClient, account?.address, networkId, isLedger, hasSigner]);

  const start = async () => {
    if (!plan || !rpcClient || !walletSigner) return;
    setIsRunning(true);
    let result: ConsolidationResult = { ...progress, cancelled: false };
    let error: unknown;
    try {
      result = await runConsolidation(
        plan.transactions,
        walletSigner,
        rpcClient,
        {
          ownerAddress: plan.ownerAddress,
          isCanceled: () => isCanceled.current,
          onTransaction: (next) => {
            result = { ...next, cancelled: false };
            setProgress(next);
          },
        },
      );
    } catch (caught) {
      error = caught ?? new Error("Signing failed");
    }

    const outcome = classifyConsolidation({
      ...result,
      failed: error !== undefined,
    });
    if (outcome === "success") {
      return navigate("/token-operation-success", {
        state: { op: "optimize" },
      });
    }
    if (outcome === "cancelled-early") {
      setIsRunning(false);
      return setCancelledEarly(result);
    }
    const report = buildRoundReport({
      extensionVersion: browser.runtime.getManifest().version,
      wasmVersion: version(),
      networkId,
      rpcUrl: rpcClient.url,
      walletType: isLedger ? "ledger" : "hot",
      // runConsolidation checks ownership first: any other error came after
      // the signer was found to own the planned address. Unavailable means
      // the check could not run, so the answer is unknown, not "no".
      signerMatchesPlan:
        error instanceof SignerMismatchError
          ? false
          : error instanceof SignerUnavailableError
            ? undefined
            : true,
      accountIndex: account?.index,
      isLegacy: wallet?.isLegacyWalletEnabled ?? false,
      total: plan.transactions.length,
      submitted: result.submitted,
      rejected: result.rejected,
      feePaid: sompiToKaspaString(result.feePaid),
      // only the entries the round could spend; skipped stay as they are
      entriesBefore:
        entries === undefined ? undefined : entries.length - plan.skipped,
      skipped: plan.skipped,
      // last rejection and the error that stopped the round: not the same
      // when a later sign or reconnect failure ended it
      lastError: result.lastError,
      terminalError:
        error === undefined
          ? undefined
          : reportError(
              error instanceof Error && error.cause !== undefined
                ? `${error}: ${error.cause}`
                : error,
            ),
    });
    return navigate(
      { pathname: "/token-operation-failed" },
      {
        state: {
          error,
          op: "optimize",
          submitted: result.submitted,
          rejected: result.rejected,
          total: plan.transactions.length,
          feePaid: sompiToKaspaString(result.feePaid),
          spentOutpoints: [...(spentOutpoints ?? []), ...result.spentOutpoints],
          lastError: result.lastError && scrubReportText(result.lastError),
          report,
        },
      },
    );
  };

  const total = plan?.transactions.length ?? 0;
  const done = progress.submitted + progress.rejected;
  const progressPercentage = total ? (done / total) * 100 : 0;

  // Same connect step the send flow shows (LedgerConfirm): the signer only
  // exists once the device is connected with the Kaspa app open.
  if (isLedger && !walletSigner && !isRunning && !cancelledEarly) {
    return (
      <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
        <LedgerConnectForSign
          showPrevious={false}
          onClose={() => window.close()}
        />
      </div>
    );
  }

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header
          title="Optimize funds"
          showPrevious={false}
          showClose={!isRunning}
          onClose={() => window.close()}
        />

        <div className="mt-10 flex h-full flex-col gap-10">
          <img
            alt="castle"
            className="aspect-[686/240] w-full max-w-[343px] self-center"
            src={carriageImage}
          />

          {cancelledEarly && (
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-xl font-semibold">
                Optimization cancelled
              </span>
              <span className="text-daintree-400">
                Cancelled before the first transaction. Nothing was paid.
              </span>
            </div>
          )}

          {!isRunning && !cancelledEarly && plan && entries && (
            <OptimizeFundsConfirm
              entriesBefore={entries.length - plan.skipped}
              entriesAfter={
                entries.length -
                plan.skipped -
                plan.inputCount +
                plan.outputCount
              }
              skippedCovenant={plan.skippedCovenant}
              skippedImmature={plan.skippedImmature}
              maturityUnknown={plan.maturityUnknown}
              transactionCount={total}
              feeSompi={plan.fee}
              isLedger={isLedger}
              canConfirm={!!rpcClient && !!walletSigner}
              onConfirm={start}
            />
          )}

          {!isRunning && !cancelledEarly && plan === null && planError && (
            <span
              role="alert"
              className="self-center rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-center text-red-500"
            >
              {planError}
            </span>
          )}

          {!isRunning && !cancelledEarly && plan === null && !planError && (
            <span className="self-center text-daintree-400">
              {describeNoPlan(screened)}
            </span>
          )}

          {!isRunning && plan === undefined && (
            <div
              className="inline-block size-6 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
              role="status"
              aria-label="loading"
            ></div>
          )}

          {isRunning && (
            <>
              <div className="bg-white/1 flex flex-col gap-8 rounded-lg border border-daintree-700 p-6">
                <div className="flex items-center gap-1 text-base font-semibold">
                  <span>Optimizing</span>
                  <i className="hn hn-check-circle text-[#14B8A6]"></i>
                  <div className="flex">
                    <span className="text-[#14B8A6]">{done}</span>
                    <span>{`/${total} transactions`}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-4 w-full overflow-hidden rounded-full bg-daintree-700"
                    role="progressbar"
                  >
                    <div
                      className="flex flex-col justify-center overflow-hidden whitespace-nowrap rounded-full bg-icy-blue-400 text-center text-xs text-white transition duration-500"
                      style={{ width: `${progressPercentage}%` }}
                    ></div>
                  </div>
                  <span className="text-base font-bold">
                    {progressPercentage.toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center gap-1 text-base">
                  <span>Fee Paid</span>
                  <i className="hn hn-check-circle text-[#14B8A6]"></i>
                  <div className="flex">
                    <span className="text-[#14B8A6]">
                      {sompiToKaspaString(progress.feePaid)}
                    </span>
                    <span>{`/${sompiToKaspaString(plan?.fee ?? 0n)} KAS`}</span>
                  </div>
                </div>
                {progress.rejected > 0 && (
                  <span className="text-daintree-400">
                    {`${progress.submitted} of ${total} transactions sent · ${progress.rejected} rejected`}
                  </span>
                )}
              </div>

              <div className="mt-auto flex flex-col items-center gap-2">
                <button
                  onClick={() => {
                    isCanceled.current = true;
                    setIsCanceledUi(true);
                  }}
                  className="mt-auto flex w-full items-center justify-center gap-2 rounded-full border border-daintree-400 py-4 text-lg font-medium text-white transition-colors hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
                >
                  {isCanceledUi ? (
                    <div
                      className="inline-block size-6 animate-spin rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                      role="status"
                      aria-label="loading"
                    ></div>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
                <span className="text-daintree-400">
                  You can cancel anytime
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
