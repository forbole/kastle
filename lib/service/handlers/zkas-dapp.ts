import { finishZKasDappPayment } from "@/api/background/zkas-dapp-payment";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { isZKasDappPopupSender, zkasDappPendingStore, type ZKasDappPending } from "@/lib/zkas/dapp-payment";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection } from "@/lib/zkas/selection";
import type { Message } from "../extension-service";
import { z } from "zod";

const IdSchema = z.string().uuid();
const OutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
    daemonReportedFeeSompi: z.string().regex(/^(0|[1-9]\d*)$/),
  }),
  z.object({ status: z.enum(["denied", "failed", "uncertain"]) }),
]);

async function pendingForPopup(approvalId: unknown, sender: chrome.runtime.MessageSender): Promise<ZKasDappPending> {
  const id = IdSchema.parse(approvalId);
  const pending = await zkasDappPendingStore.get(id);
  if (!pending) throw new Error("ZKas website payment request expired");
  if (!isZKasDappPopupSender(pending, sender)) throw new Error("ZKas approval window changed");
  return pending;
}

async function assertCurrentConnected(pending: ZKasDappPending): Promise<void> {
  const current = await zkasKeyService.publicAccount();
  if (!sameZKasSelection(current, pending.account) || current.address !== pending.account.address) {
    throw new Error("Selected ZKas account changed. Review the payment again.");
  }
  if (!hasZKasConnection(await zkasConnectionStore.list(), pending.origin, current)) {
    throw new Error("ZKas website was disconnected. Payment stopped.");
  }
  await zkasKeyService.checkSelection(current);
}

export const zkasDappPendingGet = async (
  { approvalId }: Message<{ approvalId: string }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  const pending = await pendingForPopup(approvalId, sender);
  sendResponse({
    origin: pending.origin,
    account: pending.account,
    to: pending.to,
    amountSompi: pending.amountSompi,
    maxFeeSompi: pending.maxFeeSompi,
  });
};

export const zkasDappCheck = async (
  { approvalId }: Message<{ approvalId: string }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  const pending = await pendingForPopup(approvalId, sender);
  await assertCurrentConnected(pending);
  sendResponse({ ok: true });
};

export const zkasDappComplete = async (
  { approvalId, outcome }: Message<{ approvalId: string; outcome: unknown }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  await pendingForPopup(approvalId, sender);
  const result = OutcomeSchema.parse(outcome);
  const publicOutcome = result.status === "success"
    ? { txid: result.txid, daemonReportedFeeSompi: result.daemonReportedFeeSompi }
    : { error: result.status === "denied"
      ? "User denied ZKas payment"
      : result.status === "uncertain"
        ? "ZKas payment outcome is uncertain. Check Kastle activity before retrying."
        : "ZKas payment failed. Check the Kastle window for details." };
  sendResponse(await finishZKasDappPayment(approvalId, publicOutcome));
};
