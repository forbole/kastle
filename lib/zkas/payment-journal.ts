import type { ZKasSelection } from "./selection";

const JOURNAL_KEY = "local:zkas-payment-journal-v1";
const ACTIVE_REVIEW_DELAY_MS = 10 * 60 * 1000;

export type ZKasPaymentRecord = {
  id: string;
  selection: ZKasSelection;
  status: "preparing" | "submitting" | "uncertain" | "success";
  updatedAt: number;
  txid?: string;
};

type JournalStore = {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
};

function selectionKey(selection: ZKasSelection): string {
  return JSON.stringify([selection.walletId, selection.accountIndex, selection.network]);
}

export class ZKasPaymentJournal {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly store: JournalStore;
  private readonly now: () => number;

  constructor(store: JournalStore, now = Date.now) {
    this.store = store;
    this.now = now;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async all(): Promise<Record<string, ZKasPaymentRecord>> {
    return (await this.store.getItem<Record<string, ZKasPaymentRecord>>(JOURNAL_KEY)) ?? {};
  }

  get(selection: ZKasSelection): Promise<ZKasPaymentRecord | undefined> {
    return this.run(async () => (await this.all())[selectionKey(selection)]);
  }

  acquire(selection: ZKasSelection): Promise<ZKasPaymentRecord> {
    return this.run(async () => {
      const records = await this.all();
      const key = selectionKey(selection);
      const existing = records[key];
      if (existing && existing.status !== "success") {
        throw new Error("A previous ZKas payment needs review before another send");
      }
      const record: ZKasPaymentRecord = {
        id: crypto.randomUUID(),
        selection,
        status: "preparing",
        updatedAt: this.now(),
      };
      records[key] = record;
      await this.store.setItem(JOURNAL_KEY, records);
      return record;
    });
  }

  private update(
    selection: ZKasSelection,
    id: string,
    next: "submitting" | "uncertain" | "success" | "release" | "abort-before-fetch",
    txid?: string,
  ): Promise<void> {
    return this.run(async () => {
      const records = await this.all();
      const key = selectionKey(selection);
      const current = records[key];
      if (!current || current.id !== id) throw new Error("ZKas payment reservation changed");
      if (next === "submitting" && current.status !== "preparing") throw new Error("ZKas payment already submitted");
      if ((next === "uncertain" || next === "success") && current.status !== "submitting") throw new Error("ZKas payment was not marked for submission");
      if (next === "release" && current.status !== "preparing") throw new Error("Submitted ZKas payment must be reconciled");
      if (next === "abort-before-fetch" && current.status !== "submitting") throw new Error("ZKas payment was not marked for submission");
      if (next === "release" || next === "abort-before-fetch") delete records[key];
      else records[key] = { ...current, status: next, updatedAt: this.now(), ...(txid ? { txid } : {}) };
      await this.store.setItem(JOURNAL_KEY, records);
    });
  }

  markSubmitting(selection: ZKasSelection, id: string): Promise<void> {
    return this.update(selection, id, "submitting");
  }

  markUncertain(selection: ZKasSelection, id: string, txid?: string): Promise<void> {
    return this.update(selection, id, "uncertain", txid);
  }

  markSuccess(selection: ZKasSelection, id: string, txid: string): Promise<void> {
    return this.update(selection, id, "success", txid);
  }

  release(selection: ZKasSelection, id: string): Promise<void> {
    return this.update(selection, id, "release");
  }

  abortBeforeFetch(selection: ZKasSelection, id: string): Promise<void> {
    return this.update(selection, id, "abort-before-fetch");
  }

  clearAfterReview(selection: ZKasSelection, id: string): Promise<void> {
    return this.run(async () => {
      const records = await this.all();
      const key = selectionKey(selection);
      const current = records[key];
      if (!current || current.id !== id) throw new Error("ZKas payment reservation changed");
      if (current.status !== "uncertain" && this.now() - current.updatedAt < ACTIVE_REVIEW_DELAY_MS) {
        throw new Error("Wait for the active payment to finish before clearing this warning");
      }
      delete records[key];
      await this.store.setItem(JOURNAL_KEY, records);
    });
  }
}

let journal: ZKasPaymentJournal | undefined;
export function getZKasPaymentJournal(): ZKasPaymentJournal {
  journal ??= new ZKasPaymentJournal(storage);
  return journal;
}
