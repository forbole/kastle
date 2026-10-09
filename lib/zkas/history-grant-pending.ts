import { z } from "zod";
import type { HistoryGrantContext } from "./history-grant";

export const HISTORY_GRANT_TIMEOUT_MS = 180_000;
export const HISTORY_GRANT_ALARM_PREFIX = "zkas-history-grant-timeout:";
export const HISTORY_GRANT_PENDING_KEY = "session:zkas-history-grant-pending";
export const HISTORY_GRANT_WORKER_EPOCH = crypto.randomUUID();

const ContextSchema = z
  .object({
    audience: z
      .object({ kind: z.literal("website"), origin: z.string().max(256) })
      .strict(),
    walletId: z.string().min(1).max(128),
    accountIndex: z.number().int().nonnegative().safe(),
    address0: z.string().max(120),
    network: z.literal("mainnet"),
    genesis: z.string().length(64),
    daemonUrl: z.string().max(256),
    indexUrl: z.string().max(256),
  })
  .strict();

const PendingSchema = z
  .object({
    approvalId: z.string().uuid(),
    pageRequestId: z.string().min(1).max(256),
    tabId: z.number().int().nonnegative().safe(),
    frameId: z.number().int().nonnegative().safe(),
    origin: z.string().max(256),
    context: ContextSchema,
    keyringSession: z.number().int().nonnegative().safe(),
    grantGeneration: z.number().int().nonnegative().safe(),
    workerEpoch: z.string().min(1).max(128),
    createdAt: z.number().int().nonnegative().safe(),
    state: z.enum(["awaiting", "verifying", "committing", "finished"]),
    popupWindowId: z.number().int().nonnegative().safe().optional(),
    popupTabId: z.number().int().nonnegative().safe().optional(),
    popupUrl: z.string().max(512).optional(),
    revision: z.string().uuid().optional(),
    delivered: z.boolean().optional(),
    finishedAt: z.number().int().nonnegative().safe().optional(),
  })
  .strict();

export type HistoryGrantPending = Omit<
  z.infer<typeof PendingSchema>,
  "context"
> & {
  context: HistoryGrantContext & {
    audience: { kind: "website"; origin: string };
  };
};

export function isHistoryGrantPopupSender(
  pending: HistoryGrantPending,
  sender: {
    id?: string;
    url?: string;
    origin?: string;
    tab?: { id?: number; windowId?: number };
    frameId?: number;
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
      sender.origin === undefined ||
      sender.origin === `${source.protocol}//${source.host}`
    );
  } catch {
    return false;
  }
}

export class HistoryGrantPendingStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly adapter: {
    get(): Promise<unknown>;
    set(value: HistoryGrantPending | null): Promise<void>;
  };
  private readonly now: () => number;
  private readonly workerEpoch: string;

  constructor(
    adapter: {
      get(): Promise<unknown>;
      set(value: HistoryGrantPending | null): Promise<void>;
    },
    now = () => Date.now(),
    workerEpoch: string = HISTORY_GRANT_WORKER_EPOCH,
  ) {
    this.adapter = adapter;
    this.now = now;
    this.workerEpoch = workerEpoch;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<HistoryGrantPending | null> {
    const raw = await this.adapter.get();
    if (raw === null) return null;
    return PendingSchema.parse(raw) as HistoryGrantPending;
  }

  private current(
    value: HistoryGrantPending | null,
  ): HistoryGrantPending | null {
    if (!value || value.workerEpoch !== this.workerEpoch) return null;
    if (value.state === "committing") return value;
    const anchor =
      value.state === "finished" ? value.finishedAt : value.createdAt;
    if (
      anchor === undefined ||
      this.now() < anchor ||
      this.now() - anchor >= HISTORY_GRANT_TIMEOUT_MS
    )
      return null;
    return value;
  }

  async acquire(value: HistoryGrantPending): Promise<void> {
    await this.run(async () => {
      if (this.current(await this.read()))
        throw new Error("A history approval is already pending");
      if (value.workerEpoch !== this.workerEpoch || value.state !== "awaiting")
        throw new Error("Invalid history approval");
      await this.adapter.set(PendingSchema.parse(value) as HistoryGrantPending);
    });
  }

  async get(id: string): Promise<HistoryGrantPending | null> {
    return this.run(async () => {
      const value = this.current(await this.read());
      return value?.approvalId === id ? value : null;
    });
  }

  async bindPopup(
    id: string,
    windowId: number,
    tabId: number,
    popupUrl: string,
  ): Promise<void> {
    await this.run(async () => {
      const value = this.current(await this.read());
      if (
        !value ||
        value.approvalId !== id ||
        value.state !== "awaiting" ||
        value.popupTabId !== undefined
      )
        throw new Error("History approval expired");
      await this.adapter.set(
        PendingSchema.parse({
          ...value,
          popupWindowId: windowId,
          popupTabId: tabId,
          popupUrl,
        }) as HistoryGrantPending,
      );
    });
  }

  private async transition(
    id: string,
    from: HistoryGrantPending["state"],
    to: HistoryGrantPending["state"],
  ): Promise<HistoryGrantPending> {
    return this.run(async () => {
      const value = this.current(await this.read());
      if (!value || value.approvalId !== id || value.state !== from)
        throw new Error("History approval changed or expired");
      await this.adapter.set({ ...value, state: to });
      return value;
    });
  }

  begin(id: string): Promise<HistoryGrantPending> {
    return this.transition(id, "awaiting", "verifying");
  }
  markCommitting(id: string): Promise<HistoryGrantPending> {
    return this.transition(id, "verifying", "committing");
  }

  async finish(
    id: string,
    revision: string | undefined,
    delivered: boolean,
  ): Promise<void> {
    await this.run(async () => {
      const value = this.current(await this.read());
      if (!value || value.approvalId !== id || value.state !== "committing")
        throw new Error("History approval changed or expired");
      await this.adapter.set(
        PendingSchema.parse({
          ...value,
          state: "finished",
          ...(revision ? { revision } : {}),
          delivered,
          finishedAt: this.now(),
        }) as HistoryGrantPending,
      );
    });
  }

  async setDelivered(id: string): Promise<void> {
    await this.run(async () => {
      const value = this.current(await this.read());
      if (!value || value.approvalId !== id || value.state !== "finished")
        throw new Error("History approval changed or expired");
      await this.adapter.set({ ...value, delivered: true });
    });
  }

  async cancel(id: string): Promise<HistoryGrantPending | null> {
    return this.run(async () => {
      const value = this.current(await this.read());
      if (
        !value ||
        value.approvalId !== id ||
        !["awaiting", "verifying"].includes(value.state)
      )
        return null;
      await this.adapter.set(null);
      return value;
    });
  }

  async takeByWindow(windowId: number): Promise<HistoryGrantPending | null> {
    return this.run(async () => {
      const value = this.current(await this.read());
      if (
        !value ||
        value.popupWindowId !== windowId ||
        value.state === "committing"
      )
        return null;
      await this.adapter.set(null);
      return value.state === "finished" ? null : value;
    });
  }

  async revokeFinished(
    id: string,
    revoke: (value: HistoryGrantPending) => Promise<void>,
  ): Promise<void> {
    await this.run(async () => {
      const value = this.current(await this.read());
      if (
        !value ||
        value.approvalId !== id ||
        (value.state !== "finished" && value.state !== "committing")
      )
        throw new Error("Committed history approval unavailable");
      await revoke(value);
      await this.adapter.set(null);
    });
  }
}

export const historyGrantPendingStore = new HistoryGrantPendingStore({
  get: () => storage.getItem<unknown>(HISTORY_GRANT_PENDING_KEY),
  set: (value) => storage.setItem(HISTORY_GRANT_PENDING_KEY, value),
});

export async function deliverHistoryGrantResult(
  record: HistoryGrantPending,
  outcome:
    | { granted: true; scope: "mj3ProtocolMessagesRead" }
    | { error: string },
): Promise<boolean> {
  const response = {
    id: record.pageRequestId,
    source: "background",
    target: "browser",
    response: "error" in outcome ? null : outcome,
    ...("error" in outcome ? { error: outcome.error } : {}),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ack = await Promise.race([
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
      !!ack &&
      typeof ack === "object" &&
      (ack as { accepted?: unknown }).accepted === true &&
      (ack as { origin?: unknown }).origin === record.origin
    );
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
