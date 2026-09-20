import { useEffect, useState } from "react";
import Header from "@/components/GeneralHeader";
import { formatZkasAmount, parseZkasSompi } from "@/lib/zkas/amount";
import {
  sendZKasPayment,
  type PublicZKasAccount,
} from "@/lib/zkas/popup-client";
import { ZKasSubmissionUncertainError } from "@/lib/zkas/client";
import { Method } from "@/lib/service/methods";
import { sendMessage } from "@/lib/utils";

type PendingView = {
  origin: string;
  account: PublicZKasAccount;
  to: string;
  amountSompi: string;
  maxFeeSompi: string;
};

async function internal<T>(method: Method, data: object): Promise<T> {
  const result = await sendMessage<T | { error: string }>(method, data);
  if (result && typeof result === "object" && "error" in result)
    throw new Error(result.error);
  return result as T;
}

export default function ZKasDappSend() {
  const approvalId =
    new URLSearchParams(window.location.search).get("approvalId") ?? "";
  const [pending, setPending] = useState<PendingView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const value = await internal<PendingView>(
            Method.ZKAS_DAPP_PENDING_GET,
            { approvalId },
          );
          if (active) setPending(value);
          return;
        } catch (cause) {
          if (!active) return;
          if (attempt === 11) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load payment request",
            );
            setFinished(true);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [approvalId]);

  const check = async () => {
    const result = await internal<{ ok: boolean }>(Method.ZKAS_DAPP_CHECK, {
      approvalId,
    });
    if (!result.ok) throw new Error("ZKas payment request changed");
  };

  const complete = async (outcome: object) => {
    return internal<{ finalized: boolean; delivered: boolean }>(
      Method.ZKAS_DAPP_COMPLETE,
      { approvalId, outcome },
    );
  };

  const cancel = async () => {
    if (busy) return;
    if (finished) {
      window.close();
      return;
    }
    setBusy(true);
    try {
      await complete({ status: "denied" });
      window.close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to cancel payment",
      );
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!pending || busy || finished) return;
    window.dispatchEvent(
      new CustomEvent("zkas-payment-phase", { detail: "busy" }),
    );
    setBusy(true);
    setError("");
    try {
      await check();
      const result = await sendZKasPayment({
        to: pending.to,
        amount: formatZkasAmount(parseZkasSompi(pending.amountSompi)),
        maxFee: formatZkasAmount(parseZkasSompi(pending.maxFeeSompi)),
        expectedAccount: pending.account,
        guard: check,
      });
      setTxid(result.txid);
      setFinished(true);
      try {
        const completion = await complete({ status: "success", ...result });
        if (!completion.delivered)
          throw new Error("Website result could not be delivered");
      } catch {
        setError(
          "Payment was submitted, but the website could not be notified. Check Kastle activity using this transaction ID.",
        );
      }
    } catch (cause) {
      setFinished(true);
      const uncertain = cause instanceof ZKasSubmissionUncertainError;
      try {
        await complete({ status: uncertain ? "uncertain" : "failed" });
      } catch {
        // The account journal remains the source of truth after interruption.
      }
      setError(cause instanceof Error ? cause.message : "ZKas payment failed");
    } finally {
      window.dispatchEvent(
        new CustomEvent("zkas-payment-phase", { detail: "done" }),
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header
        title="Approve ZKas payment"
        showPrevious={false}
        showClose={false}
      />
      <div className="space-y-3 text-sm">
        <p>
          This website requests a shielded payment. Review every detail before
          approving.
        </p>
        <p className="break-all rounded-lg bg-daintree-800 p-3">
          <strong>Website</strong>
          <br />
          {pending?.origin ?? "Loading…"}
        </p>
        <p className="break-all rounded-lg bg-daintree-800 p-3">
          <strong>From</strong>
          <br />
          {pending?.account.address ?? "Loading…"}
        </p>
        <p className="break-all rounded-lg bg-daintree-800 p-3">
          <strong>To</strong>
          <br />
          {pending?.to ?? "Loading…"}
        </p>
        {pending && (
          <p className="rounded-lg bg-daintree-800 p-3">
            <strong>Amount</strong>
            <br />
            {formatZkasAmount(parseZkasSompi(pending.amountSompi))} ZKAS
            <br />
            <strong>Maximum fee</strong>
            <br />
            {formatZkasAmount(parseZkasSompi(pending.maxFeeSompi))} ZKAS
          </p>
        )}
        {busy && (
          <p role="status">
            Preparing or submitting the ZKas payment. Keep this window open.
          </p>
        )}
        {txid && (
          <p className="break-all rounded-lg bg-daintree-800 p-3">
            <strong>Transaction ID</strong>
            <br />
            {txid}
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        {!finished && (
          <button
            type="button"
            disabled={!pending || busy}
            onClick={() => void approve()}
            className="w-full rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40"
          >
            Approve and send
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
          className="w-full rounded-full border border-daintree-700 p-3 disabled:opacity-40"
        >
          {finished ? "Close" : "Deny"}
        </button>
      </div>
    </div>
  );
}
