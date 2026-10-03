import { useEffect, useState } from "react";
import Header from "@/components/GeneralHeader";
import { Method } from "@/lib/service/methods";
import { sendMessage } from "@/lib/utils";

type ReviewFacts = {
  kind: "invite" | "decision" | "text";
  actionId: string;
  text: string;
  decision: "accept" | "reject" | null;
  referenceActionId: string | null;
  ownerPeerId: string;
  recipientPeerId: string;
  recipientCardHex: string;
  accountAddress: string;
  daemonOrigin: string;
  outputs: {
    role: "peer" | "cache" | "archive" | "collector";
    recipient: string;
    amountSompi: string;
  }[];
  explicitTotalSompi: "10000003";
  maxNetworkFeeSompi: "5000000";
  maximumTotalSompi: "15000003";
};

type PendingView = { origin: string; facts: ReviewFacts };

async function internal<T>(method: Method, data: object): Promise<T> {
  const result = await sendMessage<T | { error: string }>(method, data);
  if (result && typeof result === "object" && "error" in result)
    throw new Error(result.error);
  return result as T;
}

async function cardFingerprint(cardHex: string): Promise<string> {
  if (!/^[0-9a-f]{368}$/.test(cardHex))
    throw new Error("Invalid recipient card");
  const card = Uint8Array.from(cardHex.match(/../g)!, (byte) =>
    Number.parseInt(byte, 16),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", card));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export default function ZKasDirectAction() {
  const approvalId =
    new URLSearchParams(window.location.search).get("approvalId") ?? "";
  const [pending, setPending] = useState<PendingView>();
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const closeTimer = setTimeout(() => window.close(), 180_000);
    void (async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const value = await internal<PendingView>(
            Method.ZKAS_DIRECT_ACTION_PENDING_GET,
            { approvalId },
          );
          const digest = await cardFingerprint(value.facts.recipientCardHex);
          if (active) {
            setPending(value);
            setFingerprint(digest);
          }
          return;
        } catch (cause) {
          if (!active) return;
          if (attempt === 11) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load approval",
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

  const decide = async (decision: "approve" | "deny") => {
    if (!pending || busy || finished) return;
    setBusy(true);
    setError("");
    try {
      const result = await internal<{
        state: "pending" | "unknown" | "failed";
        delivered?: boolean;
      }>(Method.ZKAS_DIRECT_ACTION_COMPLETE, { approvalId, decision });
      setFinished(true);
      setStatus(
        result.state === "pending"
          ? result.delivered
            ? "Approval sent to the website."
            : "Approved, but the website may need to reconcile this action."
          : result.state === "failed"
            ? "Request cancelled before approval."
            : "The action may have started. Reconcile the original request before trying again.",
      );
    } catch (cause) {
      setFinished(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "Approval outcome is uncertain",
      );
      setStatus("Check the original action before trying again.");
    } finally {
      setBusy(false);
    }
  };

  const facts = pending?.facts;
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-white">
      <Header
        title="Direct message payment"
        showPrevious={false}
        showClose={false}
      />
      <div className="space-y-3 text-sm">
        <p className="break-all rounded-lg bg-daintree-800 p-3">
          {pending?.origin ?? "Loading website…"}
        </p>
        {facts && (
          <>
            <p>
              Review this{" "}
              {facts.kind === "decision"
                ? "invitation decision"
                : facts.kind === "invite"
                  ? "invitation"
                  : "message"}{" "}
              and its complete payment before approval.
            </p>
            {facts.decision && (
              <p>
                Decision: <strong>{facts.decision}</strong>
              </p>
            )}
            <p className="whitespace-pre-wrap break-words rounded-lg bg-daintree-800 p-3">
              {facts.text || "No note"}
            </p>
            <p className="break-all">From account: {facts.accountAddress}</p>
            <p className="break-all">Your peer ID: {facts.ownerPeerId}</p>
            <p className="break-all">
              Recipient peer ID: {facts.recipientPeerId}
            </p>
            {facts.referenceActionId && (
              <p className="break-all">
                Invitation ID: {facts.referenceActionId}
              </p>
            )}
            <p className="break-all">Recipient card SHA-256: {fingerprint}</p>
            <p className="break-all">Wallet service: {facts.daemonOrigin}</p>
            <div className="rounded-lg bg-daintree-800 p-3">
              <p className="font-semibold">Outputs in this one payment</p>
              {facts.outputs.map((output) => (
                <p key={output.role} className="break-all">
                  {output.role}: {output.amountSompi} sompi to{" "}
                  {output.recipient}
                </p>
              ))}
            </div>
            <p>Three recipient outputs: 1 sompi each.</p>
            <p>Collector service fee: 10,000,000 sompi (0.1 ZKAS).</p>
            <p>Exact output total: {facts.explicitTotalSompi} sompi.</p>
            <p>
              Network fee ceiling: {facts.maxNetworkFeeSompi} sompi (0.05 ZKAS).
            </p>
            <p>
              Maximum total: {facts.maximumTotalSompi} sompi (0.15000003 ZKAS).
            </p>
          </>
        )}
        {status && <p role="status">{status}</p>}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        {!finished && (
          <>
            <button
              type="button"
              disabled={!facts || busy || !fingerprint}
              onClick={() => void decide("approve")}
              className="w-full rounded-full bg-icy-blue-400 p-3 font-semibold disabled:opacity-40"
            >
              Approve and pay
            </button>
            <button
              type="button"
              disabled={!facts || busy}
              onClick={() => void decide("deny")}
              className="w-full rounded-full border border-daintree-700 p-3 disabled:opacity-40"
            >
              Cancel
            </button>
          </>
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
