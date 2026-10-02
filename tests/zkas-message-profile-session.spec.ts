import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keyring } from "@/lib/keyring-manager";

const address = "zkas:" + "a".repeat(80);
const card = Uint8Array.from({ length: 184 }, (_, index) =>
  index === 0 ? 3 : index,
);

type Dependencies = {
  keyring: Keyring;
  selection: { walletId: string; accountIndex: number; network: "mainnet" };
  settings: {
    zkasDaemonUrls: { mainnet: string };
    zkasHistoryIndexUrls: { mainnet: string };
  };
  opening?: Promise<void>;
  closed: number;
};

declare global {
  var __messageProfileDeps: Dependencies;
  var __messageSeedCapture: {
    bytes?: Uint8Array;
    opened?: Promise<void>;
    closed: number;
  };
}

async function loadService() {
  const root = process.cwd();
  const mocks: Record<string, string> = {
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
    "@/contexts/WalletManagerContext":
      "export const WALLET_SETTINGS = 'local:wallet-settings';",
    "@/lib/service/extension-service":
      "export const ExtensionService = { getInstance: () => ({ getKeyring: () => globalThis.__messageProfileDeps.keyring }) };",
    "@/lib/wallet-settings-storage":
      "export const updateWalletSettingsLocked = async () => {};",
    "@/wasm/zkas-signer/firecash_signer_bg.wasm?url":
      "const signerAssetUrl = 'mock-wasm';",
    "@/lib/wallet-network":
      "export const ZKAS_EXPERIMENTAL_KEY = 'local:enabled'; export const ZKAS_MAINNET = 'zkas-mainnet'; export const getVisibleWalletNetworks = () => ['zkas-mainnet']; export const isZKasActive = () => true;",
    "./history-config":
      "export const ZKAS_MAINNET_GENESIS = 'b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f';",
    "./amount": "export const parseZkasSompi = () => 0n;",
    "./memo": "export const validateZKasMemo = () => {};",
    "./signer": `
      export const initZKasSigner = async () => {};
      export const deriveZKasAccount = async () => ({ address: ${JSON.stringify(address)} });
      export const deriveZKasAccountFromSeed = async () => ({ address: ${JSON.stringify(address)} });
      export const openSelectedPrivateMessagingAccount = async (_source, _index, _address, signal) => {
        if (globalThis.__messageProfileDeps.opening) await globalThis.__messageProfileDeps.opening;
        if (signal.aborted) throw Error('Selected private messaging account changed');
        return { publicCard: () => Uint8Array.from(${JSON.stringify(Array.from(card))}), close: () => { globalThis.__messageProfileDeps.closed += 1 } };
      };
    `,
    "./selection": `
      export const loadSelectedZKasAccount = async keyring => ({ selection: { ...globalThis.__messageProfileDeps.selection }, settings: { ...globalThis.__messageProfileDeps.settings }, keyringVersion: keyring.getSessionVersion() });
      export const sameZKasSelection = (a, b) => a.walletId === b.walletId && a.accountIndex === b.accountIndex && a.network === b.network;
      export const getZKasSecretSource = () => ({ type: 'seed', value: '01'.repeat(32) });
      export const addOrRecoverZKasSeed = () => {}; export const getSelectedAvailableZKasAddress = () => {};
      export const listZKasSwitchAccounts = () => []; export const normalizeZKasSeedHex = value => value;
    `,
  };
  const source = readFileSync(resolve(root, "lib/zkas/key-service.ts"), "utf8");
  const classSource = source.slice(
    source.indexOf("export type ZKasCredentials"),
  );
  const bundled = await transform(
    `${Object.values(mocks).join("\n")}\n${classSource}`,
    {
      loader: "ts",
      format: "iife",
      globalName: "ProfileTestModule",
      target: "es2022",
    },
  );
  return new Function(
    `${bundled.code}\nreturn ProfileTestModule.ZKasKeyService;`,
  )() as new () => {
    publicMessagingProfile(): Promise<{
      protocolId: string;
      accountAddress: string;
      peerId: string;
      publicCard: string;
    }>;
    openPrivateMessagingSession(): Promise<{
      publicCard(): Uint8Array;
      assertCurrent(): Promise<void>;
      close(): void;
    }>;
  };
}

async function loadSignerHelper() {
  const source = readFileSync(
    resolve(process.cwd(), "lib/zkas/signer.ts"),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("let ready:"),
    source.indexOf("async function deriveWalletToken"),
  );
  const prelude = `
    const account_seed_hex = (phrase, index) => {
      if (phrase !== 'dummy phrase' || index !== 0) throw Error('unexpected account');
      return '20'.repeat(32);
    };
    const address_from_seed = (seed, network) => seed === '20'.repeat(32) && network === 'mainnet' ? ${JSON.stringify(address)} : 'zkas:other';
    const createPrivateMessagingAccount = async (bytes, _address, signal) => {
      globalThis.__messageSeedCapture.bytes = bytes;
      if (globalThis.__messageSeedCapture.opened) await globalThis.__messageSeedCapture.opened;
      if (signal.aborted) throw Error('aborted');
      return { publicCard: () => new Uint8Array(184), close: () => { globalThis.__messageSeedCapture.closed++; } };
    };
  `;
  const result = await transform(
    `${prelude}\n${body}\nexport const startTestSigner = () => { ready = Promise.resolve(); };`,
    {
      loader: "ts",
      format: "iife",
      globalName: "SignerHelperModule",
      target: "es2022",
    },
  );
  return new Function(`${result.code}\nreturn SignerHelperModule;`)() as {
    startTestSigner(): void;
    openSelectedPrivateMessagingAccount(
      source: { type: "mnemonic" | "seed"; value: string },
      index: number,
      selected: string,
      signal: AbortSignal,
    ): Promise<{ close(): void }>;
  };
}

async function fixture() {
  const values = new Map<string, unknown>();
  values.set("local:wallet-settings", {
    wallets: [{ id: "wallet-1", accounts: [{ index: 0, address }] }],
  });
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
  const keyring = new Keyring(`message-profile-${crypto.randomUUID()}`);
  (keyring as unknown as { masterKey: CryptoKey }).masterKey =
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
  await keyring.setValue("wallets", []);
  globalThis.__messageProfileDeps = {
    keyring,
    selection: { walletId: "wallet-1", accountIndex: 0, network: "mainnet" },
    settings: {
      zkasDaemonUrls: { mainnet: "http://localhost:8765" },
      zkasHistoryIndexUrls: { mainnet: "http://localhost:8786" },
    },
    closed: 0,
  };
  return { keyring, values };
}

test("selected private account projects only the card and genesis-scoped peer ID", async () => {
  await fixture();
  const Service = await loadService();
  const result = await new Service().publicMessagingProfile();
  const protocolHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("matjam-onchain-v3"),
    ),
  );
  const genesis = Uint8Array.from(
    "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f".match(
      /.{2}/g,
    )!,
    (part) => Number.parseInt(part, 16),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from([...genesis, ...protocolHash, ...card.subarray(44, 76)]),
    ),
  );
  expect(result).toEqual({
    protocolId: "matjam-onchain-v3",
    accountAddress: address,
    peerId: Buffer.from(digest.subarray(0, 16)).toString("hex"),
    publicCard: Buffer.from(card).toString("hex"),
  });
  expect(globalThis.__messageProfileDeps.closed).toBe(1);
  expect(JSON.stringify(result)).not.toContain("seed");
});

test("lock requested during delayed private-loader opening cannot return a handle", async () => {
  const { keyring } = await fixture();
  const Service = await loadService();
  let release!: () => void;
  globalThis.__messageProfileDeps.opening = new Promise<void>((resolve) => {
    release = resolve;
  });
  const opening = new Service().openPrivateMessagingSession();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await keyring.lock();
  release();
  await expect(opening).rejects.toThrow(/changed/i);
});

test("a new private account cannot start after lock is queued behind unrelated work", async () => {
  const { keyring } = await fixture();
  const Service = await loadService();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const unrelated = keyring.updateValue("zkasBatchJournal", async () => {
    await blocked;
    return [];
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const locking = keyring.lock();
  await expect(new Service().openPrivateMessagingSession()).rejects.toThrow(
    /changed/i,
  );
  expect(globalThis.__messageProfileDeps.closed).toBe(0);
  release();
  await Promise.all([unrelated, locking]);
});

test("selection switch and wallet-secret mutation close an opened private account", async () => {
  const { keyring } = await fixture();
  const Service = await loadService();
  const session = await new Service().openPrivateMessagingSession();
  globalThis.__messageProfileDeps.selection = {
    walletId: "wallet-2",
    accountIndex: 0,
    network: "mainnet",
  };
  await expect(session.assertCurrent()).rejects.toThrow(/changed/i);
  expect(globalThis.__messageProfileDeps.closed).toBe(1);
  globalThis.__messageProfileDeps.selection = {
    walletId: "wallet-1",
    accountIndex: 0,
    network: "mainnet",
  };
  const second = await new Service().openPrivateMessagingSession();
  await keyring.setValue("wallets", []);
  expect(() => second.publicCard()).toThrow(/changed|closed/i);
  expect(globalThis.__messageProfileDeps.closed).toBe(2);
});

test("selected legacy seed is copied, checked against address zero, and cleared before loader awaits", async () => {
  const helper = await loadSignerHelper();
  helper.startTestSigner();
  globalThis.__messageSeedCapture = { closed: 0 };
  let release!: () => void;
  globalThis.__messageSeedCapture.opened = new Promise((resolve) => {
    release = resolve;
  });
  const signal = new AbortController();
  const opening = helper.openSelectedPrivateMessagingAccount(
    { type: "mnemonic", value: "dummy phrase" },
    0,
    address,
    signal.signal,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(Array.from(globalThis.__messageSeedCapture.bytes ?? [])).toEqual(
    new Array(32).fill(0),
  );
  release();
  (await opening).close();
  expect(globalThis.__messageSeedCapture.closed).toBe(1);
  await expect(
    helper.openSelectedPrivateMessagingAccount(
      { type: "seed", value: "20".repeat(32) },
      1,
      address,
      signal.signal,
    ),
  ).rejects.toThrow();
  await expect(
    helper.openSelectedPrivateMessagingAccount(
      { type: "seed", value: "20".repeat(32) },
      0,
      "zkas:wrong",
      signal.signal,
    ),
  ).rejects.toThrow();
  await expect(
    helper.openSelectedPrivateMessagingAccount(
      { type: "other" as "seed", value: "20".repeat(32) },
      0,
      address,
      signal.signal,
    ),
  ).rejects.toThrow();
});
