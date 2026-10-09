import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { Action, ApiResponseSchema } from "@/api/message";
import { isTrustedZKasPageRequest } from "@/api/background/zkas-origin";
import { directActionFactory } from "@/lib/zkas/direct-action-factory";
import { canonicalHistoryDaemonOrigin } from "@/lib/zkas/history-config";
import {
  parseDirectActionId,
  parseDirectActionRequest,
} from "@/lib/zkas/direct-action-request";
import {
  directActionPopupStore,
  DIRECT_ACTION_POPUP_ALARM_PREFIX,
  DIRECT_ACTION_POPUP_TIMEOUT_MS,
  type DirectActionPopupPending,
} from "@/lib/zkas/direct-action-popup";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";

function publicActionResult(value: unknown, expectedId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid direct action result");
  const action = value as Record<string, unknown>;
  if (
    action.actionId !== expectedId ||
    typeof action.state !== "string" ||
    !["pending", "unknown", "confirmed", "failed"].includes(action.state)
  )
    throw new Error("Direct action changed");
  return {
    actionId: expectedId,
    state: action.state as "pending" | "unknown" | "confirmed" | "failed",
  };
}

export function publicDirectActionReply(value: unknown, expectedId: string) {
  const base = publicActionResult(value, expectedId);
  if (base.state !== "pending") return base;
  const preparation = (value as { preparation?: unknown }).preparation;
  if (preparation === undefined) return base;
  if (
    !preparation ||
    typeof preparation !== "object" ||
    Array.isArray(preparation)
  )
    throw new Error("Invalid direct preparation descriptor");
  const p = preparation as Record<string, unknown>;
  if (
    typeof p.daemonOrigin !== "string" ||
    p.daemonOrigin.length > 256 ||
    typeof p.logicalId !== "string" ||
    !/^[0-9a-f]{64}$/.test(p.logicalId) ||
    typeof p.capability !== "string" ||
    !/^[0-9a-f]{64}$/.test(p.capability) ||
    !Number.isSafeInteger(p.expiresAtUnix) ||
    (p.expiresAtUnix as number) <= 0
  )
    throw new Error("Invalid direct preparation descriptor");
  canonicalHistoryDaemonOrigin(p.daemonOrigin);
  return {
    ...base,
    preparation: {
      daemonOrigin: p.daemonOrigin,
      logicalId: p.logicalId,
      capability: p.capability,
      expiresAtUnix: p.expiresAtUnix as number,
    },
  };
}

function pageOrigin(
  message: { origin?: string; id: string },
  sender: chrome.runtime.MessageSender,
): string {
  if (
    !message.origin ||
    !isTrustedZKasPageRequest(message.origin, sender, browser.runtime.id) ||
    sender.frameId === undefined ||
    message.id.length < 1 ||
    message.id.length > 256
  )
    throw new Error("Invalid direct website request");
  return message.origin;
}

async function clearAlarm(id: string): Promise<void> {
  try {
    await browser.alarms.clear(`${DIRECT_ACTION_POPUP_ALARM_PREFIX}${id}`);
  } catch {
    /* The worker-memory approval is still invalidated. */
  }
}

export async function deliverDirectActionResult(
  record: DirectActionPopupPending,
  result:
    | { actionId: string; state: "failed" | "unknown" }
    | Awaited<ReturnType<typeof directActionFactory.acceptApproval>>,
): Promise<boolean> {
  const response = ApiResponseSchema.parse({
    id: record.pageRequestId,
    source: "background",
    target: "browser",
    response: result,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const acknowledgement = await Promise.race([
      browser.tabs.sendMessage(
        record.tabId,
        { kind: "ZKAS_DAPP_RESULT", origin: record.origin, response },
        { frameId: record.frameId },
      ),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 5_000);
      }),
    ]);
    return (
      !!acknowledgement &&
      typeof acknowledgement === "object" &&
      (acknowledgement as { accepted?: unknown }).accepted === true &&
      (acknowledgement as { origin?: unknown }).origin === record.origin
    );
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function rejectAndDeliver(
  record: DirectActionPopupPending,
): Promise<void> {
  let result: { actionId: string; state: "failed" | "unknown" } = {
    actionId: record.actionId,
    state: "unknown",
  };
  try {
    const rejected = directActionFactory.rejectApproval(record.approvalId);
    if (
      rejected.actionId === record.actionId &&
      (rejected.state === "failed" || rejected.state === "unknown")
    )
      result = { actionId: record.actionId, state: rejected.state };
  } catch {
    /* A missing or uncertain factory action never becomes a clean failure. */
  }
  await clearAlarm(record.approvalId);
  await deliverDirectActionResult(record, result);
}

export const zkasDirectActionStartHandler: Handler = async (
  tabId,
  message,
  sendResponse,
  sender,
) => {
  const origin = pageOrigin(message, sender);
  const kind =
    message.action === Action.MJ3_INVITE
      ? "invite"
      : message.action === Action.MJ3_DECIDE_INVITATION
        ? "decision"
        : "text";
  const input = parseDirectActionRequest(kind, message.payload);
  const page = {
    pageRequestId: message.id,
    origin,
    tabId,
    frameId: sender.frameId!,
    createdAt: Date.now(),
  };
  let begun: { approvalId: string; actionId: string } | undefined;
  let pending: DirectActionPopupPending;
  try {
    const started = await directActionPopupStore.start(async () => {
      const review = await directActionFactory.startReview(origin, input);
      begun = {
        approvalId: review.approvalId,
        actionId: review.facts.actionId,
      };
      return { ...begun, value: null };
    }, page);
    pending = started.pending;
  } catch (cause) {
    if (!begun) throw cause;
    let state: "failed" | "unknown" = "unknown";
    try {
      const rejected = directActionFactory.rejectApproval(begun.approvalId);
      if (
        rejected.actionId === begun.actionId &&
        (rejected.state === "failed" || rejected.state === "unknown")
      )
        state = rejected.state;
    } catch {
      /* A retained review may already require reconciliation. */
    }
    sendResponse(
      ApiUtils.createApiResponse(message.id, {
        actionId: begun.actionId,
        state,
      }),
    );
    return;
  }
  let windowId: number | undefined;
  try {
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.searchParams.set("approvalId", pending.approvalId);
    url.hash = "/zkas-direct-action";
    const popup = await browser.windows.create({
      type: "popup",
      url: url.toString(),
      width: POPUP_WINDOW_WIDTH,
      height: POPUP_WINDOW_HEIGHT,
      focused: true,
    });
    windowId = popup.id;
    if (windowId === undefined)
      throw new Error("Unable to open direct approval");
    const populated =
      popup.tabs?.length === 1
        ? popup
        : await browser.windows.get(windowId, { populate: true });
    const tab = populated.tabs?.length === 1 ? populated.tabs[0] : undefined;
    if (tab?.id === undefined || tab.windowId !== windowId)
      throw new Error("Direct approval tab unavailable");
    await directActionPopupStore.bindPopup(
      pending.approvalId,
      windowId,
      tab.id,
      url.toString(),
    );
    await browser.alarms.create(
      `${DIRECT_ACTION_POPUP_ALARM_PREFIX}${pending.approvalId}`,
      {
        when: pending.createdAt + DIRECT_ACTION_POPUP_TIMEOUT_MS,
      },
    );
    sendResponse(ApiUtils.createApiResponse(message.id, { pending: true }));
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
      /* The original action may require reconciliation. */
    }
    await clearAlarm(pending.approvalId);
    if (windowId !== undefined) {
      try {
        await browser.windows.remove(windowId);
      } catch {
        /* Already closed. */
      }
    }
    sendResponse(ApiUtils.createApiResponse(message.id, receipt));
  }
};

export const zkasDirectActionCompleteHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
  sender,
) => {
  const origin = pageOrigin(message, sender);
  const actionId = parseDirectActionId(message.payload);
  const result = await directActionFactory.complete(origin, actionId);
  sendResponse(
    ApiUtils.createApiResponse(
      message.id,
      publicActionResult(result, actionId),
    ),
  );
};

export const zkasDirectActionStatusHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
  sender,
) => {
  const origin = pageOrigin(message, sender);
  const actionId = parseDirectActionId(message.payload);
  const result = await directActionFactory.status(origin, actionId);
  sendResponse(
    ApiUtils.createApiResponse(
      message.id,
      publicActionResult(result, actionId),
    ),
  );
};

export const zkasDirectActionPendingHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
  sender,
) => {
  const origin = pageOrigin(message, sender);
  if (message.payload !== undefined)
    throw new Error("Pending direct action takes no arguments");
  const result = await directActionFactory.pending(origin);
  if (
    result !== null &&
    (!/^[0-9a-f]{32}$/.test(result.actionId) ||
      (result.state !== "pending" && result.state !== "unknown"))
  )
    throw new Error("Invalid pending direct action");
  sendResponse(
    ApiUtils.createApiResponse(
      message.id,
      result === null
        ? null
        : { actionId: result.actionId, state: result.state },
    ),
  );
};

export const zkasDirectActionResumeHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
  sender,
) => {
  const origin = pageOrigin(message, sender);
  const actionId = parseDirectActionId(message.payload);
  const result = await directActionFactory.resume(origin, actionId);
  sendResponse(
    ApiUtils.createApiResponse(
      message.id,
      publicDirectActionReply(result, actionId),
    ),
  );
};

export function listenForDirectActionClosure(): void {
  browser.windows.onRemoved.addListener((windowId) => {
    const record = directActionPopupStore.invalidateByWindow(windowId);
    if (record) void rejectAndDeliver(record);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    const record = directActionPopupStore.invalidateByTab(tabId);
    if (record) void rejectAndDeliver(record);
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const record = directActionPopupStore.getByPopupTab(tabId);
    if (record && changeInfo.url && changeInfo.url !== record.popupUrl) {
      directActionPopupStore.invalidateByTab(tabId);
      void rejectAndDeliver(record);
    }
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(DIRECT_ACTION_POPUP_ALARM_PREFIX)) return;
    const record = directActionPopupStore.expire(
      alarm.name.slice(DIRECT_ACTION_POPUP_ALARM_PREFIX.length),
    );
    if (record) void rejectAndDeliver(record);
  });
}
