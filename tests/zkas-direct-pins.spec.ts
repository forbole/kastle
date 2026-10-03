import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Keyring } from "../lib/keyring-manager";
import { DIRECT_PINS_KEY, DirectPinStore } from "../lib/zkas/direct-pins";

const genesis =
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";
const card =
  "038ed378a8807a9754bf714e5d89a6bfc0bd07377141fa5467e9084db285637a48ed6436eb1522abd3b2a41131fe26ae96b276b1def2f7ce74b1ea12dcac3feacb87330710ce0fd0416dd5e1bbd564c20358e87b9f3c4adc42726c721e8936aa0fb6f58f8d717760d577c10d0000000000000000ffffffffda33fbc6f47ad5c98918fae8892a4a1f8087126175272aaf9b480b15fa54827c8e10c417e194dc44dc06d4c579c72967fb0cb721a079e68d789193db58586201";
const raw = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const peer = createHash("sha256")
  .update(Buffer.from(genesis, "hex"))
  .update(createHash("sha256").update("matjam-onchain-v3").digest())
  .update(Buffer.from(card, "hex").subarray(44, 76))
  .digest("hex")
  .slice(0, 32);
const ctx = {
  audience: { kind: "website" as const, origin: "https://messages.example" },
  walletId: "wallet-1",
  accountIndex: 0,
  address0: "zkas:" + "a".repeat(79),
  network: "mainnet" as const,
  genesis,
  daemonUrl: "https://daemon.example",
  indexUrl: "https://index.example",
};
const birth = {
  ...ctx,
  birthHash: "22".repeat(32),
  birthDaa: "7",
  birthBlue: "8",
  originalSourceGeneration: "3",
  sessionId: "33".repeat(16),
};
const approved = {
  recipientCard: raw(card),
  recipientPeerId: raw(peer),
  birthHash: raw(birth.birthHash),
  sessionId: raw(birth.sessionId),
  sourceGeneration: 4n,
};

async function fixture() {
  const values = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    },
  });
  const keyring = new Keyring("test-direct-pins");
  (keyring as unknown as { masterKey: CryptoKey }).masterKey =
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
  return { store: new DirectPinStore(keyring), keyring, values };
}

test("native-approved card is encrypted, survives reopen, and is idempotent", async () => {
  const { store, keyring, values } = await fixture();
  await store.recordNativeApproved(ctx, birth, approved, 4n, async () => {});
  expect(await store.read(ctx, birth, async () => {})).toEqual([raw(card)]);
  await store.recordNativeApproved(ctx, birth, approved, 4n, async () => {});
  expect(await store.read(ctx, birth, async () => {})).toHaveLength(1);
  const persisted = JSON.stringify(
    values.get("local:test-direct-pins:" + DIRECT_PINS_KEY),
  );
  expect(persisted).not.toContain(card);
  expect(persisted).not.toContain(peer);
  expect(
    await new DirectPinStore(keyring).read(ctx, birth, async () => {}),
  ).toEqual([raw(card)]);
});

test("changed card for same peer and changed immutable trial source fail closed", async () => {
  const { store } = await fixture();
  await store.recordNativeApproved(ctx, birth, approved, 4n, async () => {});
  const different = raw(card);
  different[180] ^= 1;
  await expect(
    store.recordNativeApproved(
      ctx,
      birth,
      { ...approved, recipientCard: different },
      4n,
      async () => {},
    ),
  ).rejects.toThrow();
  await expect(
    store.read(
      { ...ctx, daemonUrl: "https://other.example" },
      birth,
      async () => {},
    ),
  ).rejects.toThrow();
  await expect(
    store.read(ctx, { ...birth, sessionId: "44".repeat(16) }, async () => {}),
  ).rejects.toThrow();
  await expect(
    store.read(ctx, { ...birth, birthDaa: "9" }, async () => {}),
  ).rejects.toThrow();
});

test("record requires matching native review stamp and live unlocked session", async () => {
  const { store, keyring } = await fixture();
  await expect(
    store.recordNativeApproved(ctx, birth, approved, 5n, async () => {}),
  ).rejects.toThrow();
  await expect(
    store.recordNativeApproved(
      ctx,
      birth,
      { ...approved, birthHash: raw("44".repeat(32)) },
      4n,
      async () => {},
    ),
  ).rejects.toThrow();
  await store.recordNativeApproved(ctx, birth, approved, 4n, async () => {});
  await keyring.lock();
  await expect(store.read(ctx, birth, async () => {})).rejects.toThrow();
});

test("saved peer mismatch and over-capacity pin records fail closed", async () => {
  const { store, keyring } = await fixture();
  await store.recordNativeApproved(ctx, birth, approved, 4n, async () => {});
  const document = await keyring.getValue<{
    trials: Array<{ pins: Array<{ peerId: string; card: string }> }>;
  }>(DIRECT_PINS_KEY);
  expect(document).not.toBeNull();
  document!.trials[0].pins[0].peerId = "00".repeat(16);
  await keyring.setValue(DIRECT_PINS_KEY, document);
  await expect(store.read(ctx, birth, async () => {})).rejects.toThrow(
    "identity",
  );
  const pins = Array.from({ length: 129 }, (_, index) => ({
    peerId: index.toString(16).padStart(32, "0"),
    card,
  }));
  document!.trials[0].pins = pins;
  await keyring.setValue(DIRECT_PINS_KEY, document);
  await expect(store.read(ctx, birth, async () => {})).rejects.toThrow();
});

test("approved pins survive encrypted key rotation and relock", async () => {
  const values = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    },
  });
  const keyring = new Keyring("rotating-direct-pins");
  await keyring.initialize("old-password");
  const store = new DirectPinStore(keyring);
  await store.recordNativeApproved(ctx, birth, approved, 4n, async () => {});
  expect(await keyring.changePassword("old-password", "new-password")).toBe(
    true,
  );
  await keyring.lock();
  await expect(store.read(ctx, birth, async () => {})).rejects.toThrow();
  expect(await keyring.unlock("new-password")).toBe(true);
  expect(await store.read(ctx, birth, async () => {})).toEqual([raw(card)]);
});
