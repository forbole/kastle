import { expect, test } from "@playwright/test";
import { Keyring } from "@/lib/keyring-manager";
import { attachZKasSeed } from "@/lib/zkas/selection";
import type { WalletSecret } from "@/types/WalletSecret";
import { ZKasBatchJournal } from "@/lib/zkas/batch-journal";
import { readFileSync } from "node:fs";

test("concurrent ZKas imports attach only the first seed", async () => {
  const keyring = await createTestKeyring();
  const selection = {
    walletId: "wallet-1",
    accountIndex: 0,
    network: "mainnet" as const,
  };
  await keyring.setValue<WalletSecret[]>("wallets", [
    { id: "wallet-1", type: "privateKey", value: "02".repeat(32) },
  ]);

  const imports = await Promise.allSettled(
    ["01", "03"].map((byte) =>
      keyring.updateValue<WalletSecret[]>("wallets", (wallets) =>
        attachZKasSeed(wallets ?? [], selection, byte.repeat(32)),
      ),
    ),
  );

  expect(imports[0].status).toBe("fulfilled");
  expect(imports[1].status).toBe("rejected");
  expect(
    (await keyring.getValue<WalletSecret[]>("wallets"))?.[0].zkasSeedHex,
  ).toBe("01".repeat(32));
});

test("concurrent wallet addition and ZKas import preserve both changes", async () => {
  const keyring = await createTestKeyring();
  const selection = {
    walletId: "wallet-1",
    accountIndex: 0,
    network: "mainnet" as const,
  };
  await keyring.setValue<WalletSecret[]>("wallets", [
    { id: "wallet-1", type: "privateKey", value: "02".repeat(32) },
  ]);

  await Promise.all([
    keyring.updateValue<WalletSecret[]>("wallets", (wallets) =>
      attachZKasSeed(wallets ?? [], selection, "01".repeat(32)),
    ),
    keyring.updateValue<WalletSecret[]>("wallets", (wallets) => [
      ...(wallets ?? []),
      { id: "wallet-2", type: "privateKey", value: "04".repeat(32) },
    ]),
  ]);

  const wallets = await keyring.getValue<WalletSecret[]>("wallets");
  expect(wallets?.map(({ id }) => id)).toEqual(["wallet-1", "wallet-2"]);
  expect(wallets?.[0].zkasSeedHex).toBe("01".repeat(32));
});

test("private wallet handles invalidate when lock is requested behind a queued mutation", async () => {
  const keyring = await createTestKeyring();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invalidations: string[] = [];
  keyring.subscribePrivateWalletInvalidation((reason) =>
    invalidations.push(reason),
  );
  const mutating = keyring.updateValue<WalletSecret[]>("wallets", async () => {
    await blocked;
    return [];
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const locking = keyring.lock();
  expect(invalidations).toContain("lock");
  release();
  await Promise.all([mutating, locking]);
});

test("private wallet handles invalidate at the start of wallet-secret replacement", async () => {
  const keyring = await createTestKeyring();
  const invalidations: string[] = [];
  const unsubscribe = keyring.subscribePrivateWalletInvalidation((reason) =>
    invalidations.push(reason),
  );
  await keyring.setValue<WalletSecret[]>("wallets", []);
  expect(invalidations).toContain("wallets");
  unsubscribe();
  const previous = invalidations.length;
  await keyring.setValue<WalletSecret[]>("wallets", []);
  expect(invalidations).toHaveLength(previous);
});

test("queued private work blocks new sessions until every operation settles", async () => {
  const keyring = await createTestKeyring();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const unrelated = keyring.updateValue("zkasBatchJournal", async () => {
    await blocked;
    return [];
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const walletWrite = keyring.setValue("wallets", []);
  const locking = keyring.lock();
  expect(keyring.isPrivateWalletWorkPending()).toBe(true);
  release();
  await Promise.allSettled([unrelated, walletWrite, locking]);
  expect(keyring.isPrivateWalletWorkPending()).toBe(false);
});

test("a failed clear keeps private admission blocked until every started deletion finishes", async () => {
  const keyring = await createTestKeyring();
  await keyring.setValue("wallets", []);
  const backing = (
    globalThis as unknown as {
      storage: { removeItem(key: string): Promise<void> };
    }
  ).storage;
  const originalRemove = backing.removeItem;
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let walletDeletionSettled = false;
  backing.removeItem = async (key: string) => {
    if (key.endsWith(":wallets")) {
      entered();
      await blocked;
      await originalRemove(key);
      walletDeletionSettled = true;
      return;
    }
    if (key.endsWith(":salt")) throw new Error("storage failure");
    await originalRemove(key);
  };
  const clearing = keyring.clear().then(
    () => "fulfilled",
    () => "rejected",
  );
  try {
    await reached;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(keyring.isPrivateWalletWorkPending()).toBe(true);
    expect(walletDeletionSettled).toBe(false);
  } finally {
    release();
    expect(await clearing).toBe("rejected");
    backing.removeItem = originalRemove;
  }
  expect(walletDeletionSettled).toBe(true);
  expect(keyring.isPrivateWalletWorkPending()).toBe(false);
});

test("signed batch bytes stay encrypted through lock, unlock, and password rotation", async () => {
  const values = installTestStorage();
  const keyring = new Keyring(`test-batch-${crypto.randomUUID()}`);
  await keyring.initialize("first-password");
  const journal = new ZKasBatchJournal(keyring, async () => false);
  const intent = {
    selection: {
      walletId: "wallet",
      accountIndex: 0,
      network: "mainnet" as const,
    },
    account: "zkas:" + "a".repeat(80),
    genesis: "1".repeat(64),
    origin: "https://example.test",
    logicalId: "2".repeat(64),
    outputs: [
      {
        recipient: "zkas:" + "b".repeat(80),
        amountSompi: "1",
        memoHex: "00".repeat(512),
      },
    ],
    maxFeeSompi: "1000000",
  };
  await journal.reserve(intent);
  const prepared = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-v3-prepared.json", import.meta.url),
      "utf8",
    ),
  );
  prepared.account = intent.account;
  prepared.outputs = intent.outputs.map((output) => ({
    recipient: output.recipient,
    amount: output.amountSompi,
    memo: output.memoHex,
  }));
  prepared.fee = intent.maxFeeSompi;
  const signatures = [{ actionIndex: 0, signatureHex: "7".repeat(128) }];
  const signedTicket = JSON.stringify({
    format: "zkas-private-signed-payment",
    version: 1,
    approvalDigest: "8".repeat(64),
    prepared,
    signatures,
  });
  await journal.saveSignedTicket(intent, {
    signedTicket,
    session: "6".repeat(48),
    daemonIdentity: "https://wallet.example.test",
    preparedChecksum: prepared.checksum,
    signatures,
  });
  const transactionHex = "ab".repeat(100);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(100).fill(0xab),
  );
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  await journal.saveFinalized(intent, {
    transactionHex,
    txid: "3".repeat(64),
    sha256,
  });
  expect(JSON.stringify([...values.values()])).not.toContain(transactionHex);
  expect(JSON.stringify([...values.values()])).not.toContain(signedTicket);
  await keyring.lock();
  await expect(journal.get(intent.logicalId)).rejects.toThrow(/locked/i);
  expect(await keyring.unlock("first-password")).toBe(true);
  expect((await journal.get(intent.logicalId))?.transactionHex).toBe(
    transactionHex,
  );
  expect((await journal.get(intent.logicalId))?.signedTicket?.value).toBe(
    signedTicket,
  );
  expect(
    await keyring.changePassword("first-password", "second-password"),
  ).toBe(true);
  await keyring.lock();
  expect(await keyring.unlock("second-password")).toBe(true);
  expect((await journal.get(intent.logicalId))?.transactionHex).toBe(
    transactionHex,
  );
});

async function createTestKeyring(): Promise<Keyring> {
  installTestStorage();
  const keyring = new Keyring(`test-${crypto.randomUUID()}`);
  (keyring as unknown as { masterKey: CryptoKey }).masterKey =
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
  return keyring;
}

function installTestStorage(): Map<string, unknown> {
  const values = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    },
  });
  return values;
}
