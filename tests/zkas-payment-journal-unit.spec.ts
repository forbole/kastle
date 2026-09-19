import { expect, test } from "@playwright/test";
import { ZKasPaymentJournal } from "@/lib/zkas/payment-journal";

const selection = { walletId: "wallet-1", accountIndex: 0, network: "mainnet" as const };

function fakeStore() {
  const items = new Map<string, unknown>();
  return {
    getItem: async <T>(key: string): Promise<T | null> => (items.get(key) as T | undefined) ?? null,
    setItem: async <T>(key: string, value: T): Promise<void> => { items.set(key, structuredClone(value)); },
  };
}

test("concurrent extension windows cannot reserve the same account twice", async () => {
  const journal = new ZKasPaymentJournal(fakeStore());
  const results = await Promise.allSettled([journal.acquire(selection), journal.acquire(selection)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const other = await journal.acquire({ ...selection, accountIndex: 1 });
  expect(other.selection.accountIndex).toBe(1);
});

test("submission state survives a service restart and blocks retry until reviewed", async () => {
  const store = fakeStore();
  let now = 1_000_000;
  const first = new ZKasPaymentJournal(store, () => now);
  const record = await first.acquire(selection);
  await first.markSubmitting(selection, record.id);
  const restarted = new ZKasPaymentJournal(store, () => now);
  expect((await restarted.get(selection))?.status).toBe("submitting");
  await expect(restarted.acquire(selection)).rejects.toThrow(/review/i);
  await expect(restarted.release(selection, record.id)).rejects.toThrow(/reconciled/i);
  await expect(restarted.clearAfterReview(selection, record.id)).rejects.toThrow(/wait/i);
  now += 10 * 60 * 1000;
  await restarted.clearAfterReview(selection, record.id);
  expect(await restarted.get(selection)).toBeUndefined();
});

test("a failed preparation releases its reservation; an uncertain submission retains it", async () => {
  const journal = new ZKasPaymentJournal(fakeStore());
  const failed = await journal.acquire(selection);
  await journal.release(selection, failed.id);
  const next = await journal.acquire(selection);
  await journal.markSubmitting(selection, next.id);
  await journal.markUncertain(selection, next.id, "a".repeat(64));
  expect((await journal.get(selection))?.txid).toBe("a".repeat(64));
  await expect(journal.acquire(selection)).rejects.toThrow(/review/i);
  await journal.clearAfterReview(selection, next.id);
  const final = await journal.acquire(selection);
  await journal.markSubmitting(selection, final.id);
  await journal.markSuccess(selection, final.id, "b".repeat(64));
  expect((await journal.get(selection))?.status).toBe("success");
  await journal.acquire(selection);
});
