import { expect, test } from "@playwright/test";
import { Keyring } from "@/lib/keyring-manager";
import { attachZKasSeed } from "@/lib/zkas/selection";
import type { WalletSecret } from "@/types/WalletSecret";

test("concurrent ZKas imports attach only the first seed", async () => {
  const keyring = await createTestKeyring();
  const selection = { walletId: "wallet-1", accountIndex: 0, network: "mainnet" as const };
  await keyring.setValue<WalletSecret[]>("wallets", [
    { id: "wallet-1", type: "privateKey", value: "02".repeat(32) },
  ]);

  const imports = await Promise.allSettled(["01", "03"].map((byte) =>
    keyring.updateValue<WalletSecret[]>("wallets", (wallets) =>
      attachZKasSeed(wallets ?? [], selection, byte.repeat(32)),
    ),
  ));

  expect(imports[0].status).toBe("fulfilled");
  expect(imports[1].status).toBe("rejected");
  expect((await keyring.getValue<WalletSecret[]>("wallets"))?.[0].zkasSeedHex)
    .toBe("01".repeat(32));
});

test("concurrent wallet addition and ZKas import preserve both changes", async () => {
  const keyring = await createTestKeyring();
  const selection = { walletId: "wallet-1", accountIndex: 0, network: "mainnet" as const };
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

async function createTestKeyring(): Promise<Keyring> {
  const values = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        values.set(key, value);
      },
      removeItem: async (key: string) => { values.delete(key); },
    },
  });
  const keyring = new Keyring(`test-${crypto.randomUUID()}`);
  (keyring as unknown as { masterKey: CryptoKey }).masterKey =
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return keyring;
}
