import { chromium, expect, test } from "@playwright/test";
import { Keyring } from "@/lib/keyring-manager";
import { HistoryGrantStore } from "@/lib/zkas/history-grant";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const address0 =
  "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy";
const genesis =
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";
const account = {
  walletId: "test-wallet",
  accountIndex: 0,
  address0,
  network: "mainnet" as const,
  genesis,
};
const saved = {
  ...account,
  audience: { kind: "website" as const, origin: "https://chat.example" },
  daemonUrl: "http://localhost:8765",
  indexUrl: "http://127.0.0.1:8786",
};

function testStorage() {
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
  return values;
}

test("saved website grants remain listable across source changes and revoke by exact revision", async () => {
  testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const store = new HistoryGrantStore(keyring);
  const revision = await store.approve(saved, async () => undefined);
  const records = await store.listForAccount(account, async () => undefined);
  expect(records).toHaveLength(1);
  expect(records[0].revision).toBe(revision);
  expect(records[0].daemonUrl).toBe(saved.daemonUrl);
  expect(
    await store.listForAccount(
      { ...account, walletId: "other" },
      async () => undefined,
    ),
  ).toEqual([]);
  await store.revokeIfRevision(saved, revision, async () => undefined);
  expect(await store.listForAccount(account, async () => undefined)).toEqual(
    [],
  );
});

test("stale displayed revision cannot delete a later approval", async () => {
  testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const store = new HistoryGrantStore(keyring);
  const first = await store.approve(saved, async () => undefined);
  const replacement = await store.approve(saved, async () => undefined);
  await expect(
    store.revokeIfRevision(saved, first, async () => undefined),
  ).rejects.toThrow();
  expect(
    (await store.listForAccount(account, async () => undefined))[0].revision,
  ).toBe(replacement);
});

test("malformed encrypted document fails list rather than appearing empty", async () => {
  testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const store = new HistoryGrantStore(keyring);
  await keyring.setValue("zkasHistoryGrants", { version: 2, records: [] });
  await expect(
    store.listForAccount(account, async () => undefined),
  ).rejects.toThrow();
});

test("wallet-owned list survives lock and password rotation, then clear removes it", async () => {
  const values = testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("first-password");
  const store = new HistoryGrantStore(keyring);
  await store.approve(saved, async () => undefined);
  await keyring.lock();
  await expect(
    store.listForAccount(account, async () => undefined),
  ).rejects.toThrow();
  expect(await keyring.unlock("first-password")).toBe(true);
  expect(
    await store.listForAccount(account, async () => undefined),
  ).toHaveLength(1);
  expect(
    await keyring.changePassword("first-password", "second-password"),
  ).toBe(true);
  await keyring.lock();
  expect(await keyring.unlock("second-password")).toBe(true);
  expect(
    await store.listForAccount(account, async () => undefined),
  ).toHaveLength(1);
  expect(JSON.stringify([...values.values()])).not.toContain(
    saved.audience.origin,
  );
  await keyring.clear();
  await expect(
    store.listForAccount(account, async () => undefined),
  ).rejects.toThrow();
});

test("a grant mutation during decryption fails list and cannot leak old rows", async () => {
  testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const store = new HistoryGrantStore(keyring);
  await store.approve(saved, async () => undefined);
  const originalGet = storage.getItem;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  storage.getItem = async (key: string) => {
    if (key.includes("zkasHistoryGrants")) {
      entered();
      await gate;
    }
    return originalGet(key as Parameters<typeof storage.getItem>[0]);
  };
  try {
    const pending = store.listForAccount(account, async () => undefined);
    await reading;
    await keyring.setValue("zkasHistoryGrants", { version: 1, records: [] });
    release();
    await expect(pending).rejects.toThrow();
    expect(await store.listForAccount(account, async () => undefined)).toEqual(
      [],
    );
  } finally {
    release();
    storage.getItem = originalGet;
  }
});

test("approval racing a serialized revoke retains the new revision", async () => {
  testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const store = new HistoryGrantStore(keyring);
  const old = await store.approve(saved, async () => undefined);
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const revoke = store.revokeIfRevision(saved, old, async () => {
    entered();
    await gate;
  });
  await reached;
  const replacement = await store.approve(saved, async () => undefined);
  release();
  await expect(revoke).rejects.toThrow();
  expect(
    (await store.listForAccount(account, async () => undefined))[0].revision,
  ).toBe(replacement);
});

async function buildManagementService() {
  const root = process.cwd();
  const unusedHandlers = [
    "keyringStatusHandler",
    "keyringInitialize",
    "keyringUnlock",
    "keyringLock",
    "keyringAddWalletSecret",
    "keyringGetWalletSecret",
    "keyringReset",
    "keyringRemoveWalletSecret",
    "reopenPopup",
    "keyringCheckPassword",
    "keyringChangePassword",
    "kaspaSignTransactionHandler",
    "kaspaSignMessageHandler",
    "kaspaGetPublicKeysHandler",
    "evmGetPublicKeyHandler",
    "evmSignTransactionHandler",
    "evmSignTypedDataHandler",
    "evmSignMessageHandler",
    "zkasGetAccount",
    "zkasGetSelectedAddress",
    "zkasGetSwitchAccounts",
    "zkasGetCredentials",
    "zkasCheckSelection",
    "zkasSign",
    "zkasPaymentStatus",
    "zkasPaymentAcquire",
    "zkasPaymentSubmitting",
    "zkasPaymentUncertain",
    "zkasPaymentSuccess",
    "zkasPaymentRelease",
    "zkasPaymentClear",
    "zkasPaymentAbortBeforeFetch",
    "zkasConnectionRemove",
    "zkasPreviewSeed",
    "zkasImportSeed",
    "zkasDappCheck",
    "zkasDappComplete",
    "zkasDappPendingGet",
    "zkasHistoryGrantComplete",
    "zkasHistoryGrantPendingGet",
  ];
  const mocks: Record<string, string> = {
    "@/lib/keyring-manager.ts":
      "export class Keyring { constructor() { return globalThis.__managementDeps.keyring; } }",
    "@/lib/auto-lock-manager.ts":
      "export class AutoLockManager { listen() {} }",
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
    "@/lib/zkas/key-service":
      "export const zkasKeyService = { publicAccount: async () => ({ ...globalThis.__managementDeps.account }) };",
    "@/lib/zkas/connection":
      "export const zkasConnectionStore = { list: async () => globalThis.__managementDeps.connections }; export const hasZKasConnection = (items, origin, account) => (items?.[origin] ?? []).some(x => x.walletId === account.walletId && x.accountIndex === account.accountIndex && x.network === account.network);",
    "./connection":
      "export const isAllowedZKasDappOrigin = value => { try { const url = new URL(value); return url.origin === value && url.protocol === 'https:'; } catch { return false; } };",
    "@/lib/zkas/selection":
      "export const sameZKasSelection = (a, b) => a.walletId === b.walletId && a.accountIndex === b.accountIndex && a.network === b.network;",
    "@/lib/wallet-network":
      "export const ZKAS_EXPERIMENTAL_KEY = 'local:zkas-enabled'; export const assertZKasActive = (settings, enabled) => { if (!settings?.active || enabled !== true) throw Error('ZKas unavailable'); };",
  };
  const output = await build({
    entryPoints: [resolve(root, "lib/service/extension-service.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "management-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /handlers\// }, (args) =>
            args.path.includes("zkas-history-grants")
              ? null
              : { path: "unused-handler", namespace: "management-mock" },
          );
          plugin.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "management-mock" }
              : { path: resolve(root, `${args.path.slice(2)}.ts`) },
          );
          plugin.onResolve({ filter: /^\.\/connection$/ }, (args) =>
            args.importer.endsWith("history-grant.ts")
              ? { path: "./connection", namespace: "management-mock" }
              : null,
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "management-mock" },
            (args) => ({
              contents:
                args.path === "unused-handler"
                  ? unusedHandlers
                      .map((name) => `export const ${name} = async () => {};`)
                      .join("\n")
                  : mocks[args.path],
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const directory = mkdtempSync(join(tmpdir(), "kastle-history-management-"));
  const file = join(directory, "service.mjs");
  writeFileSync(file, output.outputFiles[0].contents);
  stop();
  return {
    file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("extension dispatch lists saved grants and rejects hostile or stale revokes", async () => {
  const values = testStorage();
  const keyring = new Keyring(`history-management-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const store = new HistoryGrantStore(keyring);
  const first = await store.approve(saved, async () => undefined);
  values.set("local:settings", {
    active: true,
    zkasDaemonUrls: { mainnet: saved.daemonUrl },
    zkasHistoryIndexUrls: { mainnet: saved.indexUrl },
  });
  values.set("local:zkas-enabled", true);
  const deps = {
    keyring,
    account: {
      walletId: account.walletId,
      accountIndex: account.accountIndex,
      network: "mainnet",
      address: address0,
    },
    connections: {
      [saved.audience.origin]: [
        { walletId: account.walletId, accountIndex: 0, network: "mainnet" },
      ],
    },
  };
  Object.assign(globalThis, { __managementDeps: deps });
  let listener:
    | ((
        message: unknown,
        sender: unknown,
        response: (value: unknown) => void,
      ) => boolean)
    | undefined;
  Object.assign(globalThis, {
    browser: {
      runtime: {
        id: "test",
        getURL: (path: string) => `chrome-extension://test${path}`,
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
    },
  });
  const artifact = await buildManagementService();
  try {
    const { ExtensionService, Method } = await import(
      pathToFileURL(artifact.file).href
    );
    ExtensionService.getInstance().startListening();
    const trusted = { id: "test", url: "chrome-extension://test/popup.html" };
    const dispatch = async (message: object, sender = trusted) =>
      new Promise<Record<string, unknown>>((resolve) => {
        expect(
          listener?.(message, sender, (value) =>
            resolve(value as Record<string, unknown>),
          ),
        ).toBe(true);
      });
    const listed = await dispatch({ method: Method.ZKAS_HISTORY_GRANTS_LIST });
    expect(
      (
        listed.records as Array<{
          revision: string;
          sourceStatus: string;
          connectionStatus: string;
        }>
      )[0],
    ).toMatchObject({
      revision: first,
      sourceStatus: "current",
      connectionStatus: "connected",
    });
    expect(
      (
        await dispatch({
          method: Method.ZKAS_HISTORY_GRANTS_LIST,
          extra: "forbidden",
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await dispatch(
          { method: Method.ZKAS_HISTORY_GRANTS_LIST },
          { id: "test", url: "https://chat.example" },
        )
      ).error,
    ).toBeTruthy();
    values.set("local:settings", {
      active: true,
      zkasDaemonUrls: { mainnet: "http://localhost:8766" },
      zkasHistoryIndexUrls: { mainnet: "http://127.0.0.1:8787" },
    });
    deps.connections = {};
    const stale = await dispatch({ method: Method.ZKAS_HISTORY_GRANTS_LIST });
    expect(
      (
        stale.records as Array<{
          sourceStatus: string;
          connectionStatus: string;
        }>
      )[0],
    ).toMatchObject({
      sourceStatus: "stale",
      connectionStatus: "disconnected",
    });
    values.set("local:settings", { active: true });
    const unconfigured = await dispatch({
      method: Method.ZKAS_HISTORY_GRANTS_LIST,
    });
    expect(
      (unconfigured.records as Array<{ sourceStatus: string }>)[0].sourceStatus,
    ).toBe("unconfigured");
    deps.account = { ...deps.account, accountIndex: 1 };
    expect(
      (await dispatch({ method: Method.ZKAS_HISTORY_GRANTS_LIST })).records,
    ).toEqual([]);
    expect(
      (
        await dispatch({
          method: Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED,
          origin: saved.audience.origin,
          expectedRevision: first,
        })
      ).error,
    ).toBeTruthy();
    deps.account = { ...deps.account, accountIndex: 0 };
    const replacement = await store.approve(saved, async () => undefined);
    expect(
      (
        await dispatch({
          method: Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED,
          origin: saved.audience.origin,
          expectedRevision: first,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (await store.listForAccount(account, async () => undefined))[0].revision,
    ).toBe(replacement);
    expect(
      (
        await dispatch({
          method: Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED,
          origin: "https://other.example",
          expectedRevision: replacement,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await dispatch({
          method: Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED,
          origin: saved.audience.origin,
          expectedRevision: replacement,
          extra: "forbidden",
        })
      ).error,
    ).toBeTruthy();
    expect(
      await dispatch({
        method: Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED,
        origin: saved.audience.origin,
        expectedRevision: replacement,
      }),
    ).toEqual({ revoked: true });
    expect(await store.listForAccount(account, async () => undefined)).toEqual(
      [],
    );
  } finally {
    artifact.cleanup();
  }
});

test("Settings screen displays a disconnected saved grant and refreshes after revoke", async () => {
  const root = process.cwd();
  const mocks: Record<string, string> = {
    "@/components/GeneralHeader":
      "export default function Header() { return null; }",
    "@/hooks/useSettings":
      "export const useSettings = () => [{ zkasDaemonUrls: { mainnet: 'http://localhost:8765' }, zkasHistoryIndexUrls: { mainnet: 'http://127.0.0.1:8786' } }, null, false];",
    "@/hooks/wallet/useWalletManager":
      "export default function useWalletManager() { return { walletSettings: { selectedWalletId: 'test-wallet', selectedAccountIndex: 0 }, refreshKaspaAddresses: async () => {} }; }",
    "@/hooks/useSwitchNetwork":
      "export default function useSwitchNetwork() { return { switchZKasNetwork: async () => {} }; }",
    "@/hooks/useStorageState":
      "export default function useStorageState(key) { return key.includes('connections') ? [{}, null, false] : [true, null, false]; }",
    "@/lib/zkas/client": "export const getZKasDaemonOriginPattern = () => '*';",
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
    "@/lib/zkas/connection":
      "export const ZKAS_CONNECTIONS_KEY = 'local:zkas-connections';",
    "@/lib/service/methods":
      "export const Method = { ZKAS_HISTORY_GRANTS_LIST: 'ZKAS_HISTORY_GRANTS_LIST', ZKAS_HISTORY_GRANT_REVOKE_SAVED: 'ZKAS_HISTORY_GRANT_REVOKE_SAVED' };",
    "@/lib/utils":
      "export const sendMessage = (method, data) => window.__historyManagementBridge(method, data);",
    "@/lib/wallet-network":
      "export const ZKAS_EXPERIMENTAL_KEY = 'local:zkas-enabled'; export const ZKAS_MAINNET = 'zkas-mainnet'; export const getVisibleWalletNetworks = () => ['zkas-mainnet'];",
    "@/lib/zkas/popup-client":
      "export const getZKasDaemonBirthday = async () => {}; export const getSelectedZKasAddress = async () => null; export const registerSelectedZKasWallet = async () => {};",
    "@/contexts/WalletManagerContext":
      "export const WALLET_SETTINGS = 'local:wallet-settings';",
    "@/lib/wallet-settings-storage":
      "export const withWalletSettingsLock = async fn => fn();",
    "@/lib/settings-storage":
      "export const updateSettingsLocked = async () => {};",
    "@/lib/zkas/history-config":
      "export const canonicalHistoryIndexOrigin = x => x; export const historyIndexHostPattern = x => x;",
    "@/lib/network-type": "export const NetworkType = { Mainnet: 'mainnet' };",
  };
  const output = await build({
    stdin: {
      contents:
        "import {createRoot} from 'react-dom/client'; import Screen from './components/screens/zkas/ZKasSettings'; createRoot(document.getElementById('root')).render(<Screen />);",
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    write: false,
    plugins: [
      {
        name: "history-settings-boundary",
        setup(plugin) {
          plugin.onResolve({ filter: /^react-router-dom$/ }, () => ({
            path: "router",
            namespace: "settings-mock",
          }));
          plugin.onResolve({ filter: /^@\// }, (args) => ({
            path: args.path,
            namespace: "settings-mock",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "settings-mock" },
            (args) => ({
              contents:
                args.path === "router"
                  ? "export const useNavigate = () => () => {}; export const useLocation = () => ({state:null});"
                  : mocks[args.path],
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  stop();
  let rows = [
    {
      origin: saved.audience.origin,
      scope: "mj3ProtocolMessagesRead",
      revision: "00000000-0000-4000-8000-000000000001",
      daemonUrl: saved.daemonUrl,
      indexUrl: saved.indexUrl,
      sourceStatus: "stale",
      connectionStatus: "disconnected",
    },
  ];
  const calls: Array<{
    method: string;
    data?: { origin: string; expectedRevision: string };
  }> = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    await page.exposeFunction(
      "__historyManagementBridge",
      async (
        method: string,
        data?: { origin: string; expectedRevision: string },
      ) => {
        calls.push({ method, data });
        if (method.endsWith("REVOKE_SAVED")) {
          expect(data).toEqual({
            origin: saved.audience.origin,
            expectedRevision: rows[0].revision,
          });
          rows = [];
          return { revoked: true };
        }
        return {
          account: {
            walletId: account.walletId,
            accountIndex: 0,
            address0,
            network: "mainnet",
          },
          records: rows,
        };
      },
    );
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).pathname === "/settings.js") {
        await route.fulfill({
          contentType: "text/javascript",
          body: output.outputFiles[0].text,
        });
      } else {
        await route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/settings.js"></script>',
        });
      }
    });
    await page.goto("http://127.0.0.1:19453/settings.html");
    await expect(
      page.getByRole("region", { name: "Message history access" }),
    ).toContainText("Source: stale · Website: disconnected");
    await expect(
      page.getByRole("region", { name: "Message history access" }),
    ).toContainText(saved.audience.origin);
    await page.getByRole("button", { name: "Revoke history access" }).click();
    await expect(
      page.getByRole("region", { name: "Message history access" }),
    ).toContainText("No saved website access");
    expect(
      calls.filter(({ method }) => method.endsWith("REVOKE_SAVED")),
    ).toHaveLength(1);
  } finally {
    await browser.close();
  }
});
