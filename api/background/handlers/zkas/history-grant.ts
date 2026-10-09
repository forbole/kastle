import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import { ExtensionService } from "@/lib/service/extension-service";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import {
  ZKAS_MAINNET_GENESIS,
  canonicalHistoryDaemonOrigin,
  requireHistoryIndexOrigin,
} from "@/lib/zkas/history-config";
import {
  HISTORY_GRANTS_KEY,
  type HistoryGrantContext,
} from "@/lib/zkas/history-grant";
import {
  HISTORY_GRANT_ALARM_PREFIX,
  HISTORY_GRANT_TIMEOUT_MS,
  HISTORY_GRANT_WORKER_EPOCH,
  deliverHistoryGrantResult,
  historyGrantPendingStore,
  type HistoryGrantPending,
} from "@/lib/zkas/history-grant-pending";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection } from "@/lib/zkas/selection";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";
import { assertZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";

function assertCapturedKeyring(session: number, generation: number): void {
  const keyring = ExtensionService.getInstance().getKeyring();
  if (
    !keyring.isUnlocked() ||
    keyring.getSessionVersion() !== session ||
    keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== generation
  )
    throw new Error("History approval context changed");
}

export const zkasHistoryGrantHandler: Handler = async (
  tabId,
  message,
  sendResponse,
  sender,
) => {
  if (
    (message.payload !== undefined &&
      (typeof message.payload !== "object" ||
        message.payload === null ||
        Array.isArray(message.payload) ||
        Object.keys(message.payload).length !== 0)) ||
    !message.origin ||
    sender.frameId === undefined
  )
    throw new Error("Invalid history approval request");
  const keyring = ExtensionService.getInstance().getKeyring();
  const session = keyring.getSessionVersion();
  const grantGeneration = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
  assertCapturedKeyring(session, grantGeneration);
  const account = await zkasKeyService.publicAccount();
  assertCapturedKeyring(session, grantGeneration);
  if (account.network !== "mainnet")
    throw new Error("Select ZKas Mainnet first");
  const [settings, enabled] = await Promise.all([
    storage.getItem<Settings>(SETTINGS_KEY),
    storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
  ]);
  assertCapturedKeyring(session, grantGeneration);
  assertZKasActive(settings, enabled);
  if (!settings?.zkasDaemonUrls?.mainnet)
    throw new Error("Configure a ZKas daemon first");
  const daemonUrl = canonicalHistoryDaemonOrigin(
    settings.zkasDaemonUrls.mainnet,
  );
  const indexUrl = requireHistoryIndexOrigin(settings);
  const connected = hasZKasConnection(
    await zkasConnectionStore.list(),
    message.origin,
    account,
  );
  assertCapturedKeyring(session, grantGeneration);
  if (!connected) throw new Error("Connect this website to ZKas first");
  await zkasKeyService.checkSelection(account, daemonUrl, session);
  assertCapturedKeyring(session, grantGeneration);
  const current = await zkasKeyService.publicAccount();
  assertCapturedKeyring(session, grantGeneration);
  if (
    !sameZKasSelection(account, current) ||
    current.address !== account.address
  )
    throw new Error("Selected ZKas account changed");

  const approvalId = crypto.randomUUID();
  const context: HistoryGrantContext & {
    audience: { kind: "website"; origin: string };
  } = {
    audience: { kind: "website", origin: message.origin },
    walletId: account.walletId,
    accountIndex: account.accountIndex,
    address0: account.address,
    network: "mainnet",
    genesis: ZKAS_MAINNET_GENESIS,
    daemonUrl,
    indexUrl,
  };
  const pending: HistoryGrantPending = {
    approvalId,
    pageRequestId: message.id,
    tabId,
    frameId: sender.frameId,
    origin: message.origin,
    context,
    keyringSession: session,
    grantGeneration,
    workerEpoch: HISTORY_GRANT_WORKER_EPOCH,
    createdAt: Date.now(),
    state: "awaiting",
  };
  await historyGrantPendingStore.acquire(pending);
  let windowId: number | undefined;
  try {
    assertCapturedKeyring(session, grantGeneration);
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.searchParams.set("approvalId", approvalId);
    url.hash = "/zkas-history-grant";
    const popup = await browser.windows.create({
      type: "popup",
      url: url.toString(),
      width: POPUP_WINDOW_WIDTH,
      height: POPUP_WINDOW_HEIGHT,
      focused: true,
    });
    assertCapturedKeyring(session, grantGeneration);
    windowId = popup.id;
    if (windowId === undefined)
      throw new Error("Unable to open history approval");
    const populated =
      popup.tabs?.length === 1
        ? popup
        : await browser.windows.get(windowId, { populate: true });
    assertCapturedKeyring(session, grantGeneration);
    const tab = populated.tabs?.length === 1 ? populated.tabs[0] : undefined;
    if (tab?.id === undefined || tab.windowId !== windowId)
      throw new Error("History approval tab unavailable");
    await historyGrantPendingStore.bindPopup(
      approvalId,
      windowId,
      tab.id,
      url.toString(),
    );
    assertCapturedKeyring(session, grantGeneration);
    await browser.alarms.create(`${HISTORY_GRANT_ALARM_PREFIX}${approvalId}`, {
      when: pending.createdAt + HISTORY_GRANT_TIMEOUT_MS,
    });
    assertCapturedKeyring(session, grantGeneration);
    sendResponse(ApiUtils.createApiResponse(message.id, { pending: true }));
  } catch (cause) {
    await historyGrantPendingStore.cancel(approvalId);
    if (windowId !== undefined) {
      try {
        await browser.windows.remove(windowId);
      } catch {
        /* The popup may already be closed. */
      }
    }
    throw cause;
  }
};

export function listenForHistoryGrantClosure(): void {
  browser.windows.onRemoved.addListener((windowId) => {
    void (async () => {
      const record = await historyGrantPendingStore.takeByWindow(windowId);
      if (!record) return;
      await browser.alarms.clear(
        `${HISTORY_GRANT_ALARM_PREFIX}${record.approvalId}`,
      );
      await deliverHistoryGrantResult(record, {
        error: "History approval window closed",
      });
    })().catch(() => undefined);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(HISTORY_GRANT_ALARM_PREFIX)) return;
    void (async () => {
      const id = alarm.name.slice(HISTORY_GRANT_ALARM_PREFIX.length);
      const record = await historyGrantPendingStore.cancel(id);
      if (record)
        await deliverHistoryGrantResult(record, {
          error: "History approval timed out",
        });
    })().catch(() => undefined);
  });
}
