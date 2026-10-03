import {
  ZKasHistoryChallengeAckSchema,
  ZKasHistoryChallengeSchema,
} from "@/api/message";
import { directActionFactory } from "@/lib/zkas/direct-action-factory";
import {
  DIRECT_ACTION_POPUP_ALARM_PREFIX,
  directActionPopupStore,
  isDirectActionPopupSender,
  type DirectActionPopupPending,
} from "@/lib/zkas/direct-action-popup";
import {
  deliverDirectActionResult,
  publicDirectActionReply,
} from "@/api/background/handlers/zkas/direct-action";
import type { Message } from "../extension-service";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function pendingForPopup(id: unknown, sender: chrome.runtime.MessageSender) {
  if (typeof id !== "string" || !UUID.test(id))
    throw new Error("Invalid direct approval ID");
  const pending = directActionPopupStore.get(id);
  if (
    !pending ||
    !isDirectActionPopupSender(pending, sender, browser.runtime.id)
  )
    throw new Error("Direct approval window changed");
  return pending;
}

function bindingFor(
  pending: DirectActionPopupPending,
  sender: chrome.runtime.MessageSender,
) {
  return {
    assertCurrent() {
      if (
        directActionPopupStore.get(pending.approvalId) !== pending ||
        !isDirectActionPopupSender(pending, sender, browser.runtime.id)
      )
        throw new Error("Direct approval window changed");
    },
  };
}

async function challengeOriginalFrame(
  pending: DirectActionPopupPending,
): Promise<void> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const challenge = ZKasHistoryChallengeSchema.parse({
    kind: "ZKAS_HISTORY_ORIGIN_CHALLENGE",
    origin: pending.origin,
    nonce,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      browser.tabs.sendMessage(pending.tabId, challenge, {
        frameId: pending.frameId,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 10_000);
      }),
    ]);
    const parsed = ZKasHistoryChallengeAckSchema.safeParse(response);
    if (
      !parsed.success ||
      parsed.data.nonce !== nonce ||
      parsed.data.origin !== pending.origin
    )
      throw new Error("Requesting website frame changed");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function clearAlarm(id: string) {
  try {
    await browser.alarms.clear(`${DIRECT_ACTION_POPUP_ALARM_PREFIX}${id}`);
  } catch {
    /* In-memory approval state still changes. */
  }
}

export const zkasDirectActionPendingGet = async (
  { approvalId }: Message<{ approvalId: string }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  const pending = pendingForPopup(approvalId, sender);
  if (pending.state !== "awaiting")
    throw new Error("Direct approval already started");
  const binding = bindingFor(pending, sender);
  binding.assertCurrent();
  const facts = await directActionFactory.reviewFacts(
    pending.approvalId,
    binding,
  );
  binding.assertCurrent();
  if (facts.actionId !== pending.actionId)
    throw new Error("Direct approval changed");
  sendResponse({ origin: pending.origin, facts });
};

export const zkasDirectActionComplete = async (
  { approvalId, decision }: Message<{ approvalId: string; decision: string }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  const pending = pendingForPopup(approvalId, sender);
  if (decision !== "approve" && decision !== "deny")
    throw new Error("Invalid direct approval decision");
  if (decision === "deny") {
    if (pending.state !== "awaiting")
      throw new Error("Direct approval already started");
    directActionPopupStore.finish(pending.approvalId);
    let receipt: { actionId: string; state: "failed" | "unknown" } = {
      actionId: pending.actionId,
      state: "unknown",
    };
    try {
      const result = directActionFactory.rejectApproval(pending.approvalId);
      if (
        result.actionId === pending.actionId &&
        (result.state === "failed" || result.state === "unknown")
      )
        receipt = { actionId: pending.actionId, state: result.state };
    } catch {
      /* A missing review cannot become a clean cancellation. */
    }
    await clearAlarm(pending.approvalId);
    await deliverDirectActionResult(pending, receipt);
    sendResponse({ state: receipt.state });
    return;
  }

  const claimed = directActionPopupStore.claim(pending.approvalId);
  const assertCurrent = claimed.assertCurrent;
  try {
    assertCurrent();
    await challengeOriginalFrame(pending);
    assertCurrent();
    const result = await directActionFactory.acceptApproval(
      pending.approvalId,
      { assertCurrent },
    );
    assertCurrent();
    const publicReply = publicDirectActionReply(result, pending.actionId);
    if (publicReply.state !== "pending" || !("preparation" in publicReply))
      throw new Error("Direct approval result changed");
    directActionPopupStore.finish(pending.approvalId);
    await clearAlarm(pending.approvalId);
    const delivered = await deliverDirectActionResult(pending, publicReply);
    sendResponse({ state: "pending", delivered });
  } catch {
    directActionPopupStore.finish(pending.approvalId);
    let receipt: { actionId: string; state: "failed" | "unknown" } = {
      actionId: pending.actionId,
      state: "unknown",
    };
    try {
      const rejected = directActionFactory.rejectApproval(pending.approvalId);
      if (
        rejected.actionId === pending.actionId &&
        (rejected.state === "failed" || rejected.state === "unknown")
      )
        receipt = { actionId: pending.actionId, state: rejected.state };
    } catch {
      /* An uncertain action retains its original ID. */
    }
    await clearAlarm(pending.approvalId);
    await deliverDirectActionResult(pending, receipt);
    sendResponse({ state: receipt.state, delivered: false });
  }
};
