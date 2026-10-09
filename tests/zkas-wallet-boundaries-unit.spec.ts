import { expect, test } from "@playwright/test";
import type {
  WalletInfo,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import {
  getSelectedKaspaAccount,
  listKaspaWallets,
} from "@/lib/wallet-switcher-selection";
import {
  updateWalletSettingsLocked,
  WALLET_SETTINGS_STORAGE_KEY,
  withWalletSettingsLock,
} from "@/lib/wallet-settings-storage";
import {
  SETTINGS_STORAGE_KEY,
  updateSettingsLocked,
} from "@/lib/settings-storage";
import { addOrRecoverZKasSeed } from "@/lib/zkas/selection";
import type { WalletSecret } from "@/types/WalletSecret";
import {
  removeWalletAndSecretLocked,
  WalletSecretCleanupError,
} from "@/lib/wallet-lifecycle";

let addedNavigator = false;
test.beforeEach(() => {
  // Node 20 in CI has no global navigator; these tests provide its Locks API.
  addedNavigator = typeof navigator === "undefined";
  if (addedNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
  }
});

test.afterEach(() => {
  if (addedNavigator) Reflect.deleteProperty(globalThis, "navigator");
});

test("Kaspa wallet switcher excludes standalone ZKas seeds", () => {
  const wallets = (
    ["mnemonic", "privateKey", "ledger", "zkasSeed"] as const
  ).map((type) => ({
    id: type,
    type,
    name: type,
    backed: true,
    accounts: [
      {
        index: 0,
        name: "Account 0",
        address: type === "zkasSeed" ? "zkas:shielded" : "kaspa:transparent",
      },
    ],
  })) satisfies WalletInfo[];
  expect(listKaspaWallets(wallets).map((wallet) => wallet.type)).toEqual([
    "mnemonic",
    "privateKey",
    "ledger",
  ]);
});

test("Kaspa account lookup never returns a selected ZKas address", () => {
  const phrase = {
    id: "phrase",
    type: "mnemonic" as const,
    name: "Recovery phrase",
    backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "kaspa:phrase" }],
  };
  const shielded = {
    id: "shielded",
    type: "zkasSeed" as const,
    name: "ZKas seed",
    backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "zkas:shielded" }],
  };
  const settings: WalletSettings = {
    wallets: [phrase, shielded],
    selectedWalletId: "shielded",
    selectedAccountIndex: 0,
    lastRecoveryPhraseNumber: 1,
    lastPrivateKeyNumber: 0,
  };
  expect(getSelectedKaspaAccount(settings)).toBeNull();
  expect(
    getSelectedKaspaAccount({ ...settings, selectedWalletId: "phrase" })
      ?.address,
  ).toBe("kaspa:phrase");
});

test("two windows starting from one wallet snapshot cannot overwrite each other", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  const initial: WalletSettings = {
    wallets: [],
    selectedWalletId: undefined,
    selectedAccountIndex: undefined,
    lastRecoveryPhraseNumber: 0,
    lastPrivateKeyNumber: 0,
  };
  let persisted = initial;
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) => {
        const result = tail.then(operation);
        tail = result.catch(() => undefined);
        return result;
      },
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async (_key: string, value: WalletSettings) => {
        persisted = value;
      },
    },
  });
  try {
    const baseline = JSON.stringify(initial);
    const add = (id: string) =>
      updateWalletSettingsLocked<WalletSettings>(
        WALLET_SETTINGS_STORAGE_KEY,
        (settings) => ({
          ...settings,
          wallets: [
            ...settings.wallets,
            {
              id,
              type: "zkasSeed",
              name: id,
              backed: true,
              accounts: [
                { index: 0, name: "Account 0", address: `zkas:${id}` },
              ],
            },
          ],
        }),
        { expectedJson: baseline },
      );
    const results = await Promise.allSettled([add("first"), add("second")]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(persisted.wallets).toHaveLength(1);
    expect(persisted.wallets[0].id).toBe("first");
    await Promise.all(
      ["second", "third"].map((id) =>
        updateWalletSettingsLocked<WalletSettings>(
          WALLET_SETTINGS_STORAGE_KEY,
          (current) => ({
            ...current,
            wallets: [
              ...current.wallets,
              {
                id,
                type: "zkasSeed",
                name: id,
                backed: true,
                accounts: [
                  { index: 0, name: "Account 0", address: `zkas:${id}` },
                ],
              },
            ],
          }),
        ),
      ),
    );
    expect(persisted.wallets.map((wallet) => wallet.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});

test("concurrent functional settings updates merge against current storage", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  type TestSettings = {
    networkId: string;
    preview: boolean;
    activeChain: "kaspa" | "zkas";
    zkasDaemonUrls: { mainnet: string };
  };
  const initial: TestSettings = {
    networkId: "mainnet",
    preview: true,
    activeChain: "kaspa",
    zkasDaemonUrls: { mainnet: "https://first.example" },
  };
  let persisted = initial;
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) => {
        const result = tail.then(operation);
        tail = result.catch(() => undefined);
        return result;
      },
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async (_key: string, value: typeof initial) => {
        persisted = value;
      },
    },
  });
  try {
    await Promise.all([
      updateSettingsLocked<TestSettings>(SETTINGS_STORAGE_KEY, (current) => ({
        ...current,
        activeChain: "zkas",
      })),
      updateSettingsLocked<TestSettings>(SETTINGS_STORAGE_KEY, (current) => ({
        ...current,
        preview: false,
      })),
    ]);
    expect(persisted).toEqual({
      ...initial,
      activeChain: "zkas",
      preview: false,
    });
    expect(persisted.zkasDaemonUrls.mainnet).toBe("https://first.example");
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});

test("reset waits for a seed import to finish updating both stores", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  const initial: WalletSettings = {
    wallets: [],
    selectedWalletId: undefined,
    selectedAccountIndex: undefined,
    lastRecoveryPhraseNumber: 0,
    lastPrivateKeyNumber: 0,
  };
  let persisted = initial;
  let secrets: WalletSecret[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  let importStaged!: () => void;
  const staged = new Promise<void>((resolve) => {
    importStaged = resolve;
  });
  let continueImport!: () => void;
  const holdImport = new Promise<void>((resolve) => {
    continueImport = resolve;
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) => {
        const result = tail.then(operation);
        tail = result.catch(() => undefined);
        return result;
      },
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async (_key: string, value: WalletSettings) => {
        persisted = value;
      },
    },
  });
  try {
    const seed = "ab".repeat(32);
    const importWallet = updateWalletSettingsLocked<WalletSettings>(
      WALLET_SETTINGS_STORAGE_KEY,
      async (current) => {
        const result = addOrRecoverZKasSeed(
          secrets,
          current,
          seed,
          "seed-wallet",
        );
        secrets = result.secrets;
        importStaged();
        await holdImport;
        return {
          ...current,
          selectedWalletId: result.id,
          selectedAccountIndex: 0,
          wallets: [
            ...current.wallets,
            {
              id: result.id,
              type: "zkasSeed",
              name: "ZKas seed",
              backed: true,
              accounts: [
                { index: 0, name: "Account 0", address: "zkas:shielded" },
              ],
            },
          ],
        };
      },
    );
    await staged;
    const resetWallet = withWalletSettingsLock(async () => {
      persisted = initial;
      secrets = [];
    });
    expect(secrets).toHaveLength(1);
    continueImport();
    await Promise.all([importWallet, resetWallet]);
    expect(persisted.wallets).toHaveLength(0);
    expect(secrets).toHaveLength(0);
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});

test("failed wallet metadata write preserves the encrypted seed for import retry", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  const initial: WalletSettings = {
    wallets: [],
    selectedWalletId: undefined,
    selectedAccountIndex: undefined,
    lastRecoveryPhraseNumber: 0,
    lastPrivateKeyNumber: 0,
  };
  let persisted = initial;
  let secrets: WalletSecret[] = [];
  let failWrite = true;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) =>
        operation(),
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async (_key: string, value: WalletSettings) => {
        if (failWrite) throw new Error("metadata unavailable");
        persisted = value;
      },
    },
  });
  try {
    const seed = "cd".repeat(32);
    const importWallet = () =>
      updateWalletSettingsLocked<WalletSettings>(
        WALLET_SETTINGS_STORAGE_KEY,
        (current) => {
          const result = addOrRecoverZKasSeed(
            secrets,
            current,
            seed,
            crypto.randomUUID(),
          );
          secrets = result.secrets;
          return {
            ...current,
            wallets: [
              ...current.wallets,
              {
                id: result.id,
                type: "zkasSeed",
                name: "ZKas seed",
                backed: true,
                accounts: [
                  { index: 0, name: "Account 0", address: "zkas:shielded" },
                ],
              },
            ],
          };
        },
      );
    await expect(importWallet()).rejects.toThrow("metadata unavailable");
    expect(secrets).toHaveLength(1);
    const orphanId = secrets[0].id;
    failWrite = false;
    await importWallet();
    expect(secrets).toHaveLength(1);
    expect(persisted.wallets[0].id).toBe(orphanId);
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});

test("removing a previously sole wallet preserves a newly imported wallet", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  const phrase = {
    id: "phrase",
    type: "mnemonic" as const,
    name: "Recovery phrase",
    backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "kaspa:phrase" }],
  };
  const seedWallet = {
    id: "seed",
    type: "zkasSeed" as const,
    name: "ZKas seed",
    backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "zkas:shielded" }],
  };
  const initial: WalletSettings = {
    wallets: [phrase],
    selectedWalletId: "phrase",
    selectedAccountIndex: 0,
    lastRecoveryPhraseNumber: 1,
    lastPrivateKeyNumber: 0,
  };
  let persisted = initial;
  let secrets: WalletSecret[] = [
    { id: "phrase", type: "mnemonic", value: "phrase" },
  ];
  let tail: Promise<unknown> = Promise.resolve();
  let importStaged!: () => void;
  const staged = new Promise<void>((resolve) => {
    importStaged = resolve;
  });
  let continueImport!: () => void;
  const holdImport = new Promise<void>((resolve) => {
    continueImport = resolve;
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) => {
        const result = tail.then(operation);
        tail = result.catch(() => undefined);
        return result;
      },
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async (_key: string, value: WalletSettings) => {
        persisted = value;
      },
    },
  });
  try {
    const importing = updateWalletSettingsLocked<WalletSettings>(
      WALLET_SETTINGS_STORAGE_KEY,
      async (current) => {
        secrets.push({ id: "seed", type: "zkasSeed", value: "ab".repeat(32) });
        importStaged();
        await holdImport;
        return { ...current, wallets: [...current.wallets, seedWallet] };
      },
    );
    await staged;
    const removing = removeWalletAndSecretLocked(
      "phrase",
      {
        ...initial,
        wallets: [],
        selectedWalletId: undefined,
        selectedAccountIndex: undefined,
      },
      async (id) => {
        secrets = secrets.filter((secret) => secret.id !== id);
      },
      async () => {
        secrets = [];
      },
    );
    continueImport();
    const [, result] = await Promise.all([importing, removing]);
    expect(result.noWallet).toBe(false);
    expect(persisted.wallets.map((wallet) => wallet.id)).toEqual(["seed"]);
    expect(secrets.map((secret) => secret.id)).toEqual(["seed"]);
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});

test("failed removal metadata write never deletes the wallet secret", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  const wallet = {
    id: "seed",
    type: "zkasSeed" as const,
    name: "ZKas seed",
    backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "zkas:shielded" }],
  };
  const initial: WalletSettings = {
    wallets: [wallet],
    selectedWalletId: "seed",
    selectedAccountIndex: 0,
    lastRecoveryPhraseNumber: 0,
    lastPrivateKeyNumber: 0,
  };
  const persisted = initial;
  let secretRemoved = false;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) =>
        operation(),
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async () => {
        throw new Error("metadata unavailable");
      },
    },
  });
  try {
    await expect(
      removeWalletAndSecretLocked(
        "seed",
        {
          ...initial,
          wallets: [],
          selectedWalletId: undefined,
          selectedAccountIndex: undefined,
        },
        async () => {
          secretRemoved = true;
        },
        async () => {
          secretRemoved = true;
        },
      ),
    ).rejects.toThrow("metadata unavailable");
    expect(secretRemoved).toBe(false);
    expect(persisted.wallets[0].id).toBe("seed");
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});

test("ambiguous secret deletion does not restore a wallet with a missing key", async () => {
  const originalLocks = navigator.locks;
  const originalStorage = (globalThis as { storage?: unknown }).storage;
  const wallet = {
    id: "seed",
    type: "zkasSeed" as const,
    name: "ZKas seed",
    backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "zkas:shielded" }],
  };
  const initial: WalletSettings = {
    wallets: [wallet],
    selectedWalletId: "seed",
    selectedAccountIndex: 0,
    lastRecoveryPhraseNumber: 0,
    lastPrivateKeyNumber: 0,
  };
  let persisted = initial;
  let secretExists = true;
  let attempts = 0;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) =>
        operation(),
    },
  });
  Object.assign(globalThis, {
    storage: {
      getItem: async () => persisted,
      setItem: async (_key: string, value: WalletSettings) => {
        persisted = value;
      },
    },
  });
  try {
    const ambiguousReset = async () => {
      attempts += 1;
      secretExists = false;
      throw new Error("background reply lost");
    };
    await expect(
      removeWalletAndSecretLocked(
        "seed",
        {
          ...initial,
          wallets: [],
          selectedWalletId: undefined,
          selectedAccountIndex: undefined,
        },
        async () => {
          throw new Error("unexpected individual removal");
        },
        ambiguousReset,
      ),
    ).rejects.toBeInstanceOf(WalletSecretCleanupError);
    expect(attempts).toBe(2);
    expect(secretExists).toBe(false);
    expect(persisted.wallets).toHaveLength(0);
  } finally {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
    Object.assign(globalThis, { storage: originalStorage });
  }
});
