import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import { formatZkasAmount, parseZkasAmount } from "@/lib/zkas/amount";
import { ZKasSubmissionUncertainError } from "@/lib/zkas/client";
import {
  getZKasPaymentRecord,
  getZKasPublicAccount,
  getZKasState,
  sendZKasPayment,
  type PublicZKasAccount,
} from "@/lib/zkas/popup-client";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useSettings } from "@/hooks/useSettings";

type Step =
  | "details"
  | "confirm"
  | "broadcast"
  | "success"
  | "fail"
  | "uncertain";

export default function ZKasSend() {
  const navigate = useNavigate();
  const { walletSettings } = useWalletManager();
  const [settings] = useSettings();
  const [step, setStep] = useState<Step>("details");
  const [account, setAccount] = useState<PublicZKasAccount>();
  const [balance, setBalance] = useState<bigint>();
  const [ready, setReady] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [maxFee, setMaxFee] = useState("");
  const [error, setError] = useState("");
  const [txid, setTxid] = useState("");
  const [reportedFee, setReportedFee] = useState("");
  const uiGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    uiGeneration.current += 1;
    setAccount(undefined);
    setBalance(undefined);
    setReady(false);
    setStep("details");
    setError("");
    const load = async () => {
      try {
        const current = await getZKasPublicAccount();
        if (!active) return;
        setAccount(current);
        if (current.network !== "mainnet") {
          setError("The pinned ZKas signer cannot send on testnet.");
          return;
        }
        const state = await getZKasState(current);
        if (!active) return;
        setBalance(state.balanceSompi);
        if (!state.synced || state.missingHistory) {
          setError(
            "The ZKas daemon must finish syncing the full wallet history before sending.",
          );
        } else {
          const record = await getZKasPaymentRecord();
          if (!active) return;
          if (record && record.status !== "success") {
            setError(
              "A previous ZKas payment needs review. Return to ZKAS and check recent activity.",
            );
          } else {
            setReady(true);
          }
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load ZKas payment state",
          );
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [
    walletSettings?.selectedWalletId,
    walletSettings?.selectedAccountIndex,
    settings?.networkId,
    settings?.zkasDaemonUrls,
  ]);

  const review = () => {
    try {
      if (!ready || !account || balance === undefined)
        throw new Error("ZKas account is not ready to send");
      const requested = parseZkasAmount(amount);
      parseZkasAmount(maxFee);
      if (!to.trim().startsWith("zkas:"))
        throw new Error("Enter a mainnet ZKas address");
      if (requested > balance)
        throw new Error("Amount exceeds the shielded balance");
      setError("");
      setStep("confirm");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid ZKas payment");
    }
  };

  const submit = async () => {
    if (!account) return;
    const submitGeneration = uiGeneration.current;
    setError("");
    setStep("broadcast");
    try {
      const result = await sendZKasPayment({
        to,
        amount,
        maxFee,
        expectedAccount: account,
      });
      if (uiGeneration.current !== submitGeneration) return;
      setTxid(result.txid);
      setReportedFee(formatZkasAmount(BigInt(result.daemonReportedFeeSompi)));
      setStep("success");
    } catch (cause) {
      if (uiGeneration.current !== submitGeneration) return;
      if (cause instanceof ZKasSubmissionUncertainError) {
        setTxid(cause.txid ?? "");
        setStep("uncertain");
      } else {
        setError(
          cause instanceof Error ? cause.message : "ZKas payment failed",
        );
        setStep("fail");
      }
    }
  };

  const back = () =>
    step === "confirm" ? setStep("details") : navigate("/zkas-asset");

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header
        title="Send ZKAS"
        showPrevious={step !== "broadcast"}
        showClose={step !== "broadcast"}
        onBack={back}
        onClose={() => navigate("/dashboard")}
      />
      {step === "details" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-daintree-400">
            Available:{" "}
            {balance === undefined ? "—" : `${formatZkasAmount(balance)} ZKAS`}
          </p>
          <label className="text-sm" htmlFor="zkas-to">
            ZKas recipient
          </label>
          <input
            id="zkas-to"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="zkas:…"
            className="rounded-lg border border-daintree-700 bg-daintree-800 p-3"
          />
          <label className="text-sm" htmlFor="zkas-amount">
            Amount in ZKAS
          </label>
          <input
            id="zkas-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="rounded-lg border border-daintree-700 bg-daintree-800 p-3"
          />
          <label className="text-sm" htmlFor="zkas-fee">
            Maximum fee in ZKAS
          </label>
          <input
            id="zkas-fee"
            inputMode="decimal"
            value={maxFee}
            onChange={(event) => setMaxFee(event.target.value)}
            placeholder="Enter the fee ceiling you approve"
            className="rounded-lg border border-daintree-700 bg-daintree-800 p-3"
          />
          <p className="text-xs text-daintree-400">
            Proof preparation can take time. The signer refuses a bundle whose
            actual fee exceeds your ceiling.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <button
            disabled={!ready}
            onClick={review}
            className="rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40"
          >
            Review payment
          </button>
        </div>
      )}
      {step === "confirm" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-daintree-400">From</p>
          <p className="break-all text-xs">{account?.address}</p>
          <p className="text-sm text-daintree-400">To</p>
          <p className="break-all text-xs">{to.trim()}</p>
          <p>Amount: {amount} ZKAS</p>
          <p>Maximum fee: {maxFee} ZKAS</p>
          <p className="text-xs text-daintree-400">
            The daemon reports its fee; Kastle verifies the fee in the bundle
            stays within this maximum.
          </p>
          <button
            onClick={() => void submit()}
            className="rounded-full bg-icy-blue-400 p-3 font-semibold"
          >
            Confirm and send
          </button>
          <button
            onClick={back}
            className="rounded-full border border-daintree-700 p-3"
          >
            Back
          </button>
        </div>
      )}
      {step === "broadcast" && (
        <div
          role="status"
          className="rounded-xl bg-daintree-800 p-5 text-center"
        >
          Preparing proof, verifying payment, and submitting… Keep this window
          open.
        </div>
      )}
      {step === "success" && (
        <div className="space-y-4">
          <p className="text-lg font-semibold">ZKAS sent</p>
          <p className="break-all text-xs">Transaction ID: {txid}</p>
          <p className="text-sm">Daemon-reported fee: {reportedFee} ZKAS</p>
          <button
            onClick={() => navigate("/zkas-asset")}
            className="w-full rounded-full bg-icy-blue-400 p-3"
          >
            Done
          </button>
        </div>
      )}
      {step === "fail" && (
        <div className="space-y-4">
          <p role="alert">{error}</p>
          <button
            onClick={() => setStep("details")}
            className="w-full rounded-full border border-daintree-700 p-3"
          >
            Review details
          </button>
        </div>
      )}
      {step === "uncertain" && (
        <div className="space-y-4">
          <p role="alert" className="font-semibold">
            Payment outcome is uncertain
          </p>
          <p className="text-sm">
            The daemon may have broadcast this payment. Check your wallet
            history before making another payment.
          </p>
          {txid && (
            <p className="break-all text-xs">Possible transaction ID: {txid}</p>
          )}
          <button
            onClick={() => navigate("/zkas-asset")}
            className="w-full rounded-full border border-daintree-700 p-3"
          >
            Return to ZKAS
          </button>
        </div>
      )}
    </div>
  );
}
