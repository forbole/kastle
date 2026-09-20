import type { ZKasSelection } from "./selection";

export const ZKAS_DAPP_PENDING_KEY = "session:zkas-dapp-pending";
export const ZKAS_DAPP_ALARM_PREFIX = "zkas-dapp-timeout:";
export const ZKAS_DAPP_TIMEOUT_MS = 20 * 60_000;

export type ZKasDappPending = {
  approvalId: string;
  pageRequestId: string;
  tabId: number;
  frameId: number;
  origin: string;
  account: ZKasSelection & { address: string };
  to: string;
  amountSompi: string;
  maxFeeSompi: string;
  createdAt: number;
  windowId?: number;
};

export function isZKasDappPopupSender(
  pending: ZKasDappPending,
  sender: { url?: string; tab?: { windowId?: number } },
): boolean {
  if (
    pending.windowId === undefined ||
    sender.tab?.windowId !== pending.windowId ||
    !sender.url
  )
    return false;
  try {
    const source = new URL(sender.url);
    return (
      source.searchParams.get("approvalId") === pending.approvalId &&
      source.hash === "#/zkas-send"
    );
  } catch {
    return false;
  }
}

export class ZKasDappPendingStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly adapter: {
    get(): Promise<ZKasDappPending | null>;
    set(value: ZKasDappPending | null): Promise<void>;
  };

  constructor(
    adapter: {
      get(): Promise<ZKasDappPending | null>;
      set(value: ZKasDappPending | null): Promise<void>;
    },
    now = () => Date.now(),
  ) {
    this.adapter = adapter;
    this.now = now;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async acquire(value: ZKasDappPending): Promise<void> {
    await this.run(async () => {
      const current = await this.adapter.get();
      if (current && this.now() - current.createdAt < ZKAS_DAPP_TIMEOUT_MS) {
        throw new Error("A ZKas website payment is already awaiting review");
      }
      await this.adapter.set(value);
    });
  }

  async get(approvalId: string): Promise<ZKasDappPending | null> {
    return this.run(async () => {
      const value = await this.adapter.get();
      if (
        !value ||
        value.approvalId !== approvalId ||
        this.now() - value.createdAt >= ZKAS_DAPP_TIMEOUT_MS
      )
        return null;
      return value;
    });
  }

  async bindWindow(approvalId: string, windowId: number): Promise<void> {
    await this.run(async () => {
      const value = await this.adapter.get();
      if (!value || value.approvalId !== approvalId)
        throw new Error("ZKas payment request expired");
      await this.adapter.set({ ...value, windowId });
    });
  }

  async take(approvalId: string): Promise<ZKasDappPending | null> {
    return this.run(async () => {
      const value = await this.adapter.get();
      if (!value || value.approvalId !== approvalId) return null;
      await this.adapter.set(null);
      return value;
    });
  }

  async takeByWindow(windowId: number): Promise<ZKasDappPending | null> {
    return this.run(async () => {
      const value = await this.adapter.get();
      if (!value || value.windowId !== windowId) return null;
      await this.adapter.set(null);
      return value;
    });
  }
}

export const zkasDappPendingStore = new ZKasDappPendingStore({
  get: () => storage.getItem<ZKasDappPending>(ZKAS_DAPP_PENDING_KEY),
  set: (value) => storage.setItem(ZKAS_DAPP_PENDING_KEY, value),
});
