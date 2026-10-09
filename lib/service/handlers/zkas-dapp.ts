import { finishZKasDappPayment } from "@/api/background/zkas-dapp-payment";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import {
  isZKasDappPopupSender,
  zkasDappPendingStore,
  type ZKasDappPending,
} from "@/lib/zkas/dapp-payment";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection } from "@/lib/zkas/selection";
import type { Message } from "../extension-service";
import { z } from "zod";

const IdSchema = z.string().uuid();
const DenialSchema = z.object({ status: z.literal("denied") }).strict();

export async function pendingForPopup(
  approvalId: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<ZKasDappPending> {
  const id = IdSchema.parse(approvalId);
  const pending = await zkasDappPendingStore.get(id);
  if (!pending) throw new Error("ZKas website payment request expired");
  if (!isZKasDappPopupSender(pending, sender))
    throw new Error("ZKas approval window changed");
  return pending;
}

export async function assertCurrentConnected(
  pending: ZKasDappPending,
): Promise<void> {
  const current = await zkasKeyService.publicAccount();
  if (
    !sameZKasSelection(current, pending.account) ||
    current.address !== pending.account.address
  ) {
    throw new Error("Selected ZKas account changed. Review the payment again.");
  }
  if (
    !hasZKasConnection(
      await zkasConnectionStore.list(),
      pending.origin,
      current,
    )
  ) {
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
    memo: pending.memo,
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
  const pending = await pendingForPopup(approvalId, sender);
  DenialSchema.parse(outcome);
  if (pending.processing)
    throw new Error("ZKas payment approval is in progress");
  await zkasDappPendingStore.claim(approvalId);
  sendResponse(
    await finishZKasDappPayment(approvalId, {
      error: "User denied ZKas payment",
    }),
  );
};
