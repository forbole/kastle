export const DIRECT_ACTION_POPUP_TIMEOUT_MS = 180_000;
export const DIRECT_ACTION_POPUP_ALARM_PREFIX = "zkas-direct-action-timeout:";

export type DirectActionPopupPending = {
  approvalId: string;
  actionId: string;
  pageRequestId: string;
  origin: string;
  tabId: number;
  frameId: number;
  createdAt: number;
  popupWindowId?: number;
  popupTabId?: number;
  popupUrl?: string;
};
type Entry = DirectActionPopupPending & { state: "awaiting" | "approving" };

export function isDirectActionPopupSender(
  pending: DirectActionPopupPending,
  sender: {
    id?: string;
    url?: string;
    origin?: string;
    frameId?: number;
    tab?: { id?: number; windowId?: number };
  },
  extensionId: string,
): boolean {
  if (
    pending.popupWindowId === undefined ||
    pending.popupTabId === undefined ||
    pending.popupUrl === undefined ||
    sender.id !== extensionId ||
    sender.url !== pending.popupUrl ||
    sender.tab?.id !== pending.popupTabId ||
    sender.tab.windowId !== pending.popupWindowId ||
    sender.frameId !== 0
  )
    return false;
  try {
    const source = new URL(pending.popupUrl);
    return (
      source.pathname === "/popup.html" &&
      source.searchParams.size === 1 &&
      source.searchParams.get("approvalId") === pending.approvalId &&
      source.hash === "#/zkas-direct-action" &&
      (sender.origin === undefined ||
        sender.origin === `${source.protocol}//${source.host}`)
    );
  } catch {
    return false;
  }
}

/** Worker-memory only: page binding and popup IDs, never review text or credentials. */
export class DirectActionPopupStore {
  private entry: Entry | null = null;
  private starting = false;
  private readonly now: () => number;
  constructor(now = () => Date.now()) {
    this.now = now;
  }

  async start<T>(
    operation: () => Promise<{
      approvalId: string;
      actionId: string;
      value: T;
    }>,
    page: Omit<DirectActionPopupPending, "approvalId" | "actionId">,
  ): Promise<{ pending: DirectActionPopupPending; value: T }> {
    if (this.starting || this.active())
      throw new Error("Another direct approval is pending");
    this.starting = true;
    try {
      const result = await operation();
      const pending = {
        ...page,
        approvalId: result.approvalId,
        actionId: result.actionId,
      };
      await this.acquire(pending);
      return { pending, value: result.value };
    } finally {
      this.starting = false;
    }
  }

  private active(): Entry | null {
    const value = this.entry;
    return value &&
      this.now() >= value.createdAt &&
      this.now() - value.createdAt < DIRECT_ACTION_POPUP_TIMEOUT_MS
      ? value
      : null;
  }

  async acquire(pending: DirectActionPopupPending): Promise<void> {
    if (this.active()) throw new Error("Another direct approval is pending");
    if (
      !/^[0-9a-f-]{36}$/.test(pending.approvalId) ||
      !/^[0-9a-f]{32}$/.test(pending.actionId) ||
      !Number.isSafeInteger(pending.tabId) ||
      pending.tabId < 0 ||
      !Number.isSafeInteger(pending.frameId) ||
      pending.frameId < 0 ||
      !Number.isSafeInteger(pending.createdAt) ||
      pending.createdAt > this.now()
    )
      throw new Error("Invalid direct approval binding");
    this.entry = { ...pending, state: "awaiting" };
  }

  async bindPopup(
    id: string,
    windowId: number,
    tabId: number,
    popupUrl: string,
  ): Promise<void> {
    const value = this.get(id);
    if (
      !value ||
      value.popupWindowId !== undefined ||
      !Number.isSafeInteger(windowId) ||
      windowId < 0 ||
      !Number.isSafeInteger(tabId) ||
      tabId < 0
    )
      throw new Error("Direct approval changed");
    this.entry = {
      ...value,
      popupWindowId: windowId,
      popupTabId: tabId,
      popupUrl,
    };
  }

  get(id: string): Entry | null {
    const value = this.active();
    return value?.approvalId === id ? value : null;
  }

  getByPopupTab(tabId: number): Entry | null {
    const value = this.active();
    return value?.popupTabId === tabId ? value : null;
  }

  claim(id: string): { pending: Entry; assertCurrent(): void } {
    const value = this.get(id);
    if (!value || value.state !== "awaiting" || value.popupTabId === undefined)
      throw new Error("Direct approval changed");
    const claimed: Entry = { ...value, state: "approving" };
    this.entry = claimed;
    return {
      pending: claimed,
      assertCurrent: () => {
        if (this.get(id) !== claimed)
          throw new Error("Direct approval window changed");
      },
    };
  }

  finish(id: string): Entry | null {
    const value = this.get(id);
    if (value) this.entry = null;
    return value;
  }

  invalidateByWindow(windowId: number): Entry | null {
    const value = this.entry;
    if (!value || value.popupWindowId !== windowId) return null;
    this.entry = null;
    return value;
  }

  invalidateByTab(tabId: number): Entry | null {
    const value = this.entry;
    if (!value || value.popupTabId !== tabId) return null;
    this.entry = null;
    return value;
  }

  expire(id: string): Entry | null {
    const value = this.entry;
    if (
      !value ||
      value.approvalId !== id ||
      this.now() - value.createdAt < DIRECT_ACTION_POPUP_TIMEOUT_MS
    )
      return null;
    this.entry = null;
    return value;
  }
}

export const directActionPopupStore = new DirectActionPopupStore();
