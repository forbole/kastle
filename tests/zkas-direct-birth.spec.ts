import { expect, test } from "@playwright/test";
import type { Keyring } from "../lib/keyring-manager";
import { DirectBirthStore, DIRECT_BIRTHS_KEY } from "../lib/zkas/direct-birth";

const ctx = {
  audience: { kind: "website" as const, origin: "https://messages.example" },
  walletId: "wallet-1",
  accountIndex: 0,
  address0: "zkas:" + "a".repeat(79),
  network: "mainnet" as const,
  genesis: "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f",
  daemonUrl: "https://daemon.example",
  indexUrl: "https://index.example",
};

function actor() {
  let value: unknown = null;
  let generation = 0;
  let unlocked = true;
  const keyring = {
    getSessionVersion: () => 1,
    getMutationGeneration: (key: string) => {
      expect(key).toBe(DIRECT_BIRTHS_KEY);
      return generation;
    },
    isUnlocked: () => unlocked,
    getValue: async () => value,
    updateValueIfGeneration: async (
      _: string,
      expected: number,
      change: (current: unknown) => unknown,
    ) => {
      if (expected !== generation) throw new Error("stale birth generation");
      value = change(value);
      generation++;
      return generation;
    },
  } as unknown as Keyring;
  return {
    store: new DirectBirthStore(keyring),
    lock: () => {
      unlocked = false;
    },
    raw: () => value,
  };
}

test("an enrolled direct-chat starting point is immutable across retries and grants", async () => {
  const { store } = actor();
  const first = await store.enroll(
    ctx,
    {
      hash: "22".repeat(32),
      daa: 9007199254740993n,
      blue: 9007199254740993n,
      sourceGeneration: 7n,
    },
    async () => {},
  );
  const second = await store.enroll(
    { ...ctx, audience: { kind: "website", origin: "https://second.example" } },
    {
      hash: "33".repeat(32),
      daa: 9007199254740994n,
      blue: 9007199254740994n,
      sourceGeneration: 8n,
    },
    async () => {},
  );
  expect(second).toEqual(first);
  expect(await store.read(ctx, async () => {})).toEqual(first);
  await expect(
    store.read({ ...ctx, daemonUrl: "https://other.example" }, async () => {}),
  ).rejects.toThrow("source changed");
});

test("lock or corrupted encrypted record never becomes a fresh enrollment", async () => {
  const item = actor();
  await item.store.enroll(
    ctx,
    { hash: "22".repeat(32), daa: 1n, blue: 1n, sourceGeneration: 1n },
    async () => {},
  );
  const raw = item.raw() as { records: Array<{ birthDaa: string }> };
  raw.records[0].birthDaa = "01";
  await expect(item.store.read(ctx, async () => {})).rejects.toThrow(
    "Invalid saved",
  );
  item.lock();
  await expect(item.store.read(ctx, async () => {})).rejects.toThrow("Unlock");
});
