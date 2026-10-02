import { useEffect, useState } from "react";
import Header from "@/components/GeneralHeader";
import { Method } from "@/lib/service/methods";
import { sendMessage } from "@/lib/utils";

type PendingView = {
  origin: string;
  account: {
    walletId: string;
    accountIndex: number;
    address: string;
    network: "mainnet";
  };
  daemonUrl: string;
  indexUrl: string;
  scope: "mj3ProtocolMessagesRead";
  state: "awaiting" | "verifying" | "committing" | "finished";
  delivered: boolean | null;
};

async function internal<T>(method: Method, data: object): Promise<T> {
  const result = await sendMessage<T | { error: string }>(method, data);
  if (result && typeof result === "object" && "error" in result)
    throw new Error(result.error);
  return result as T;
}

export default function ZKasHistoryGrant() {
  const approvalId =
    new URLSearchParams(window.location.search).get("approvalId") ?? "";
  const [pending, setPending] = useState<PendingView>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [mayRevoke, setMayRevoke] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    const closeTimer = setTimeout(() => window.close(), 6 * 60_000);
    void (async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const value = await internal<PendingView>(
            Method.ZKAS_HISTORY_GRANT_PENDING_GET,
            { approvalId },
          );
          if (active) {
            setPending(value);
            if (value.state === "finished" || value.state === "committing") {
              setFinished(true);
              setMayRevoke(true);
              setStatus(
                value.state === "committing"
                  ? "Kastle could not confirm whether access was saved. Revoke it below to be safe."
                  : value.delivered
                    ? "Access was approved."
                    : "Access may be saved, but the website was not notified.",
              );
            }
          }
          return;
        } catch (cause) {
          if (!active) return;
          if (attempt === 11) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load history request",
            );
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    })();
    return () => {
      active = false;
      clearTimeout(closeTimer);
    };
  }, [approvalId]);

  const complete = (decision: "approve" | "deny" | "revoke") =>
    internal<{
      committed?: boolean;
      delivered?: boolean;
      reviewRequired?: boolean;
      revoked?: boolean;
    }>(Method.ZKAS_HISTORY_GRANT_COMPLETE, { approvalId, decision });

  const approve = async () => {
    if (!pending || busy || finished) return;
    setBusy(true);
    setError("");
    try {
      const result = await complete("approve");
      setFinished(true);
      setMayRevoke(result.committed === true || result.reviewRequired === true);
      setStatus(
        result.committed
          ? result.delivered
            ? "Message history access was approved."
            : "Access was saved, but the website was not notified. You can revoke it below."
          : result.reviewRequired
            ? "Kastle could not confirm whether access was saved. Revoke it below to be safe."
            : "Access was not approved.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to approve history access",
      );
    } finally {
      setBusy(false);
    }
  };

  const deny = async () => {
    if (busy || finished) return;
    setBusy(true);
    try {
      await complete("deny");
      window.close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to cancel history access",
      );
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (busy || !mayRevoke) return;
    setBusy(true);
    try {
      await complete("revoke");
      setMayRevoke(false);
      setStatus("Access for this website and account was revoked.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to revoke history access",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header
        title="Message history access"
        showPrevious={false}
        showClose={false}
      />
      <div className="space-y-4">
        <p className="break-all rounded-lg bg-daintree-800 p-3 text-sm">
          {pending?.origin ?? "Loading website…"}
        </p>
        <p className="text-sm">
          Kastle will privately scan this selected ZKas account to identify its
          messages. The website will receive only bounded messages belonging to
          this messaging protocol, not other wallet memos, viewing keys, or
          transaction bodies. This access cannot send funds or approve payments.
        </p>
        <p className="break-all rounded-lg bg-daintree-800 p-3 text-xs">
          {pending?.account.address ?? "Loading account…"}
        </p>
        {pending && (
          <p className="text-xs text-daintree-200">
            Wallet {pending.account.walletId}, account{" "}
            {pending.account.accountIndex}; daemon {pending.daemonUrl}; index{" "}
            {pending.indexUrl}
          </p>
        )}
        {status && (
          <p role="status" className="text-sm">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {!finished && (
          <>
            <button
              type="button"
              disabled={!pending || busy}
              onClick={() => void approve()}
              className="w-full rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40"
            >
              Approve message history
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void deny()}
              className="w-full rounded-full border border-daintree-700 p-3 disabled:opacity-40"
            >
              Cancel
            </button>
          </>
        )}
        {mayRevoke && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void revoke()}
            className="w-full rounded-full border border-red-400 p-3 disabled:opacity-40"
          >
            Revoke this website&apos;s access
          </button>
        )}
        {finished && (
          <button
            type="button"
            onClick={() => window.close()}
            className="w-full rounded-full border border-daintree-700 p-3"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
