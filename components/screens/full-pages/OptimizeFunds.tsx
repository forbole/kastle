import { useNavigate } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import Header from "@/components/GeneralHeader.tsx";
import carriageImage from "@/assets/images/carriage.png";
import { sompiToKaspaString } from "@/wasm/core/kaspa";
import {
  ConsolidationPlan,
  ConsolidationProgress,
  planConsolidation,
  runConsolidation,
} from "@/lib/consolidate";
import { useUtxoEntries } from "@/hooks/useKasFeeEstimate";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import useKaspaLedgerSigner from "@/hooks/wallet/useKaspaLedgerSigner";

export function OptimizeFundsConfirm({
  entriesBefore,
  entriesAfter,
  transactionCount,
  feeSompi,
  isLedger,
  canConfirm,
  onConfirm,
}: {
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
  const { wallet, account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const isLedger = wallet?.type === "ledger";
  const hotWalletSigner = useKaspaHotWalletSigner();
  const ledgerSigner = useKaspaLedgerSigner();
  const walletSigner = isLedger ? ledgerSigner : hotWalletSigner;
  const { data: entries } = useUtxoEntries(account?.address);

  const [plan, setPlan] = useState<ConsolidationPlan | null>();
  const [planError, setPlanError] = useState<string>();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ConsolidationProgress>({
    submitted: 0,
    rejected: 0,
    feePaid: 0n,
  });
  const [isCanceledUi, setIsCanceledUi] = useState(false);
  const isCanceled = useRef(false);

  // Planned once: the round must spend the entries the confirm step showed,
  // not whatever a 5 s revalidation brings back.
  useEffect(() => {
    if (!entries || !account?.address || !networkId || plan !== undefined)
      return;
    planConsolidation({ entries, changeAddress: account.address, networkId })
      .then((planned) => setPlan(planned ?? null))
      .catch((error) => {
        console.error(error);
        setPlanError(String(error));
        setPlan(null);
      });
  }, [entries, account?.address, networkId]);

  const start = async () => {
    if (!plan || !rpcClient || !walletSigner) return;
    setIsRunning(true);
    let done = 0;
    try {
      const result = await runConsolidation(
        plan.transactions,
        walletSigner,
        rpcClient,
        {
          isCanceled: () => isCanceled.current,
          onTransaction: (next) => {
            done = next.submitted + next.rejected;
            setProgress(next);
          },
        },
      );
      if (result.submitted === 0 && result.rejected > 0) {
        throw new Error("Every transaction was rejected by the node");
      }
    } catch (error) {
      return navigate(
        { pathname: "/token-operation-failed" },
        {
          state: {
            error,
            op: "optimize",
            timesMinted: done,
            mintTimes: plan.transactions.length,
          },
        },
      );
    }
    return navigate("/token-operation-success", {
      state: { op: "optimize" },
    });
  };

  const total = plan?.transactions.length ?? 0;
  const done = progress.submitted + progress.rejected;
  const progressPercentage = total ? (done / total) * 100 : 0;

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

          {!isRunning && plan && entries && (
            <OptimizeFundsConfirm
              entriesBefore={entries.length}
              entriesAfter={entries.length - plan.inputCount + plan.outputCount}
              transactionCount={total}
              feeSompi={plan.fee}
              isLedger={isLedger}
              canConfirm={!!rpcClient && !!walletSigner}
              onConfirm={start}
            />
          )}

          {!isRunning && plan === null && (
            <span className="self-center text-daintree-400">
              {planError ?? "Your funds already fit in a single transaction."}
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
                    {`${progress.rejected} skipped: rejected by the node`}
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
