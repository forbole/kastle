import {
  ZKasHistoryChallengeAckSchema,
  ZKasHistoryChallengeSchema,
} from "@/api/message";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { effectiveZKasSource } from "@/lib/zkas/history-config";
import { requireZKasDaemonUrl } from "@/lib/zkas/setup";
import {
  HISTORY_GRANTS_KEY,
  HistoryGrantStore,
} from "@/lib/zkas/history-grant";
import {
  HISTORY_GRANT_ALARM_PREFIX,
  deliverHistoryGrantResult,
  historyGrantPendingStore,
  isHistoryGrantPopupSender,
  type HistoryGrantPending,
} from "@/lib/zkas/history-grant-pending";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection } from "@/lib/zkas/selection";
import { assertZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";
import { z } from "zod";
import { ExtensionService, type Message } from "../extension-service";

const IdSchema = z.string().uuid();
const DecisionSchema = z.enum(["approve", "deny", "revoke"]);

function keyringFor(pending: HistoryGrantPending) {
  const keyring = ExtensionService.getInstance().getKeyring();
  if (
    !keyring.isUnlocked() ||
    keyring.getSessionVersion() !== pending.keyringSession
  )
    throw new Error("History approval wallet session changed");
  return keyring;
}

async function pendingForPopup(
  approvalId: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<HistoryGrantPending> {
  const id = IdSchema.parse(approvalId);
  const pending = await historyGrantPendingStore.get(id);
  if (!pending) throw new Error("History approval expired");
  if (!isHistoryGrantPopupSender(pending, sender, browser.runtime.id))
    throw new Error("History approval window changed");
  return pending;
}

async function assertCurrent(
  pending: HistoryGrantPending,
  originalGeneration: boolean,
): Promise<void> {
  const keyring = keyringFor(pending);
  if (
    originalGeneration &&
    keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !==
      pending.grantGeneration
  )
    throw new Error("History grant changed during approval");
  const account = await zkasKeyService.publicAccount();
  keyringFor(pending);
  if (
    !sameZKasSelection(account, pending.context) ||
    account.address !== pending.context.address0
  )
    throw new Error("Selected ZKas account changed");
  const [settings, enabled] = await Promise.all([
    storage.getItem<Settings>(SETTINGS_KEY),
    storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
  ]);
  keyringFor(pending);
  assertZKasActive(settings, enabled);
  if (!settings) throw new Error("History source configuration changed");
  requireZKasDaemonUrl(settings);
  const source = effectiveZKasSource(settings);
  if (
    source.daemonUrl !== pending.context.daemonUrl ||
    source.indexUrl !== pending.context.indexUrl
  )
    throw new Error("History source configuration changed");
  const connections = await zkasConnectionStore.list();
  keyringFor(pending);
  if (!hasZKasConnection(connections, pending.origin, account))
    throw new Error("ZKas website was disconnected");
  await zkasKeyService.checkSelection(
    account,
    pending.context.daemonUrl,
    pending.keyringSession,
  );
  keyringFor(pending);
  const latest = await historyGrantPendingStore.get(pending.approvalId);
  keyringFor(pending);
  if (
    !latest ||
    latest.workerEpoch !== pending.workerEpoch ||
    latest.popupTabId !== pending.popupTabId ||
    latest.popupWindowId !== pending.popupWindowId ||
    (latest.state !== pending.state &&
      !(pending.state === "verifying" && latest.state === "committing"))
  )
    throw new Error("History approval changed");
  if (
    originalGeneration &&
    keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !==
      pending.grantGeneration
  )
    throw new Error("History grant changed during approval");
}

function nonceHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function challengeOriginalFrame(
  pending: HistoryGrantPending,
): Promise<void> {
  const nonce = nonceHex();
  const request = ZKasHistoryChallengeSchema.parse({
    kind: "ZKAS_HISTORY_ORIGIN_CHALLENGE",
    origin: pending.origin,
    nonce,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      browser.tabs.sendMessage(pending.tabId, request, {
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

async function clearAlarm(id: string): Promise<void> {
  try {
    await browser.alarms.clear(`${HISTORY_GRANT_ALARM_PREFIX}${id}`);
  } catch {
    /* The pending state still expires. */
  }
}

export const zkasHistoryGrantPendingGet = async (
  { approvalId }: Message<{ approvalId: string }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  const pending = await pendingForPopup(approvalId, sender);
  sendResponse({
    origin: pending.origin,
    account: {
      walletId: pending.context.walletId,
      accountIndex: pending.context.accountIndex,
      address: pending.context.address0,
      network: pending.context.network,
    },
    daemonUrl: pending.context.daemonUrl,
    indexUrl: pending.context.indexUrl,
    scope: "mj3ProtocolMessagesRead",
    state: pending.state,
    delivered: pending.delivered ?? null,
  });
};

export const zkasHistoryGrantComplete = async (
  { approvalId, decision }: Message<{ approvalId: string; decision: string }>,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
) => {
  const choice = DecisionSchema.parse(decision);
  const pending = await pendingForPopup(approvalId, sender);
  if (choice === "revoke") {
    keyringFor(pending);
    await historyGrantPendingStore.revokeFinished(
      pending.approvalId,
      async (record) => {
        await new HistoryGrantStore(keyringFor(record)).revoke(record.context);
      },
    );
    await clearAlarm(pending.approvalId);
    sendResponse({ revoked: true });
    return;
  }
  if (choice === "deny") {
    const cancelled = await historyGrantPendingStore.cancel(pending.approvalId);
    if (!cancelled) throw new Error("History approval already completed");
    await clearAlarm(pending.approvalId);
    sendResponse({
      committed: false,
      delivered: await deliverHistoryGrantResult(cancelled, {
        error: "User denied history access",
      }),
    });
    return;
  }

  await historyGrantPendingStore.begin(pending.approvalId);
  let committing = false;
  let finished = false;
  try {
    await assertCurrent({ ...pending, state: "verifying" }, true);
    await challengeOriginalFrame(pending);
    await assertCurrent({ ...pending, state: "verifying" }, true);
    await historyGrantPendingStore.markCommitting(pending.approvalId);
    committing = true;
    const keyring = keyringFor(pending);
    // No await may separate this initial-generation check from approve's capture.
    if (
      keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !==
      pending.grantGeneration
    )
      throw new Error("History grant changed during approval");
    const revision = await new HistoryGrantStore(keyring).approve(
      pending.context,
      () => assertCurrent({ ...pending, state: "committing" }, false),
    );
    await historyGrantPendingStore.finish(pending.approvalId, revision, false);
    finished = true;
    const delivered = await deliverHistoryGrantResult(pending, {
      granted: true,
      scope: "mj3ProtocolMessagesRead",
    });
    if (delivered) {
      try {
        await historyGrantPendingStore.setDelivered(pending.approvalId);
      } catch {
        // The committed record remains available for wallet-owned revocation.
      }
    }
    await clearAlarm(pending.approvalId);
    sendResponse({ committed: true, delivered });
  } catch {
    if (committing) {
      if (!finished) {
        try {
          await historyGrantPendingStore.finish(
            pending.approvalId,
            undefined,
            false,
          );
        } catch {
          // A committing record still permits wallet-owned revocation.
        }
      }
      await deliverHistoryGrantResult(pending, {
        error: "History approval outcome requires wallet review",
      });
      sendResponse({
        committed: false,
        delivered: false,
        reviewRequired: true,
      });
    } else {
      const cancelled = await historyGrantPendingStore.cancel(
        pending.approvalId,
      );
      if (cancelled)
        await deliverHistoryGrantResult(cancelled, {
          error: "History approval changed or was cancelled",
        });
      sendResponse({ committed: false, delivered: false });
    }
    await clearAlarm(pending.approvalId);
  }
};
