import { chromium, expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Keyring } from "@/lib/keyring-manager";
import { DaemonBearerStore } from "@/lib/zkas/daemon-bearer";

const origin = "http://localhost:8765";
const token = "a".repeat(64);

function encryptedStorage() {
  const entries = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => entries.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        entries.set(key, value);
      },
      removeItem: async (key: string) => {
        entries.delete(key);
      },
    },
  });
  return entries;
}

async function pairingService() {
  const root = process.cwd();
  const unused = [
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
    "zkasHistoryGrantsList",
    "zkasHistoryGrantRevokeSaved",
  ];
  const mocks: Record<string, string> = {
    "@/lib/keyring-manager.ts":
      "export class Keyring { constructor() { return globalThis.__pairingDeps.keyring; } }",
    "@/lib/auto-lock-manager.ts":
      "export class AutoLockManager { listen() {} }",
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
  };
  const result = await build({
    entryPoints: [resolve(root, "lib/service/extension-service.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "pairing-service-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /handlers\// }, (args) =>
            args.path.includes("zkas-daemon-bearer")
              ? null
              : { path: "unused-handler", namespace: "pairing-service-mock" },
          );
          plugin.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "pairing-service-mock" }
              : { path: resolve(root, `${args.path.slice(2)}.ts`) },
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "pairing-service-mock" },
            (args) => ({
              contents:
                args.path === "unused-handler"
                  ? unused
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
  stop();
  const directory = mkdtempSync(join(tmpdir(), "kastle-daemon-ui-service-"));
  const file = join(directory, "service.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  return {
    file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

async function settingsBundle() {
  const root = process.cwd();
  const mocks: Record<string, string> = {
    "@/components/GeneralHeader":
      "export default function Header() { return null; }",
    "@/hooks/useSettings":
      "export const useSettings = () => [{ zkasDaemonUrls: { mainnet: 'http://localhost:8765' }, zkasHistoryIndexUrls: { mainnet: 'http://127.0.0.1:8786' } }, null, false];",
    "@/hooks/wallet/useWalletManager":
      "export default function useWalletManager() { return { walletSettings: { selectedWalletId: undefined, selectedAccountIndex: undefined }, refreshKaspaAddresses: async () => {} }; }",
    "@/hooks/useSwitchNetwork":
      "export default function useSwitchNetwork() { return { switchZKasNetwork: async () => {} }; }",
    "@/hooks/useStorageState":
      "export default function useStorageState(key) { return key.includes('connections') ? [{}, null, false] : [true, null, false]; }",
    "@/lib/zkas/client":
      "export const getZKasDaemonOriginPattern = () => 'http://localhost/*';",
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
    "@/lib/zkas/connection":
      "export const ZKAS_CONNECTIONS_KEY = 'local:zkas-connections';",
    "@/lib/service/methods":
      "export const Method = { KEYRING_STATUS: 'KEYRING_STATUS', ZKAS_DAEMON_BEARER_PAIR: 'ZKAS_DAEMON_BEARER_PAIR', ZKAS_DAEMON_BEARER_LIST: 'ZKAS_DAEMON_BEARER_LIST', ZKAS_DAEMON_BEARER_CLEAR: 'ZKAS_DAEMON_BEARER_CLEAR', ZKAS_HISTORY_GRANTS_LIST: 'ZKAS_HISTORY_GRANTS_LIST', ZKAS_HISTORY_GRANT_REVOKE_SAVED: 'ZKAS_HISTORY_GRANT_REVOKE_SAVED' };",
    "@/lib/utils":
      "export const sendMessage = (method, data) => window.__pairingBridge(method, data);",
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
  const result = await build({
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
        name: "pairing-settings-boundary",
        setup(plugin) {
          plugin.onResolve({ filter: /^react-router-dom$/ }, () => ({
            path: "router",
            namespace: "pairing-ui-mock",
          }));
          plugin.onResolve({ filter: /^@\// }, (args) => ({
            path: args.path,
            namespace: "pairing-ui-mock",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "pairing-ui-mock" },
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
  return result.outputFiles[0].text;
}

async function lifecycleBundle() {
  const result = await build({
    stdin: {
      contents: `
        import { useState } from "react";
        import { createRoot } from "react-dom/client";
        import Pairing from "./components/screens/zkas/DaemonBearerPairing";
        function Screen() {
          const [draft, setDraft] = useState("http://localhost:8765");
          return <><input aria-label="Review draft" value={draft}
            onChange={event => setDraft(event.target.value)} />
            <Pairing draftOrigin={draft} /></>;
        }
        const root = createRoot(document.getElementById("root"));
        window.__unmount = () => root.unmount();
        root.render(<Screen />);
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    write: false,
    plugins: [
      {
        name: "private-message-bridge",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({
            path: "utils",
            namespace: "pairing-lifecycle",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "pairing-lifecycle" },
            () => ({
              contents:
                "export const sendMessage = (method, data) => window.__pairingBridge(method, data);",
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  stop();
  return result.outputFiles[0].text;
}

async function lifecycleFixture() {
  const entries = encryptedStorage();
  const keyring = new Keyring(`pairing-lifecycle-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  entries.set("local:settings", { zkasDaemonUrls: { mainnet: origin } });
  Object.assign(globalThis, { __pairingDeps: { keyring } });
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
          addListener: (value: typeof listener) => (listener = value),
        },
      },
      permissions: { contains: async () => true },
    },
  });
  const service = await pairingService();
  const { ExtensionService } = await import(pathToFileURL(service.file).href);
  ExtensionService.getInstance().startListening();
  const calls: string[] = [];
  let statusGate: (() => Promise<void>) | undefined;
  let listGate: (() => Promise<void>) | undefined;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage();
  await page.exposeFunction("__pairingPermission", async () => true);
  await page.exposeFunction(
    "__pairingBridge",
    async (method: string, data: object = {}) => {
      calls.push(method);
      const response =
        method === "KEYRING_STATUS"
          ? { isInitialized: true, isUnlocked: keyring.isUnlocked() }
          : await new Promise<unknown>((resolve) =>
              listener?.(
                { method, ...data },
                { id: "test", url: "chrome-extension://test/popup.html" },
                resolve,
              ),
            );
      if (method === "KEYRING_STATUS" && statusGate) {
        const gate = statusGate;
        statusGate = undefined;
        await gate();
      }
      if (method === "ZKAS_DAEMON_BEARER_LIST" && listGate) {
        const gate = listGate;
        listGate = undefined;
        await gate();
      }
      return response;
    },
  );
  await page.addInitScript(
    "window.browser = { permissions: { request: () => window.__pairingPermission() } };",
  );
  const bundle = await lifecycleBundle();
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).pathname === "/ui.js")
      await route.fulfill({ contentType: "text/javascript", body: bundle });
    else
      await route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div><script src="/ui.js"></script>',
      });
  });
  await page.goto("https://dummy-pairing.invalid/");
  const input = page.getByLabel("Daemon bearer token");
  await expect(input).toBeEnabled();
  return {
    page,
    input,
    calls,
    store: new DaemonBearerStore(keyring),
    holdStatus(gate: () => Promise<void>) {
      statusGate = gate;
    },
    holdList(gate: () => Promise<void>) {
      listGate = gate;
    },
    async close() {
      await browser.close();
      service.cleanup();
    },
  };
}

test("wallet settings offers daemon credential pairing without a selected ZKas account", async () => {
  const bundle = await settingsBundle();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    await page.exposeFunction("__pairingBridge", async (method: string) =>
      method === "KEYRING_STATUS"
        ? { isInitialized: true, isUnlocked: true }
        : method === "ZKAS_HISTORY_GRANTS_LIST"
          ? {
              account: {
                walletId: "",
                accountIndex: 0,
                address0: "",
                network: "mainnet",
              },
              records: [],
            }
          : { records: [] },
    );
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).pathname === "/settings.js")
        await route.fulfill({ contentType: "text/javascript", body: bundle });
      else
        await route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/settings.js"></script>',
        });
    });
    await page.goto("http://127.0.0.1:19454/settings.html");
    await expect(
      page.getByRole("region", { name: "Daemon transport credential" }),
    ).toBeVisible();
  } finally {
    await browser.close();
  }
});

test("wallet-owned UI pairs and clears via the trusted encrypted dispatcher without revealing the token", async () => {
  const entries = encryptedStorage();
  const keyring = new Keyring(`pairing-ui-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  entries.set("local:settings", { zkasDaemonUrls: { mainnet: origin } });
  Object.assign(globalThis, { __pairingDeps: { keyring } });
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
      permissions: { contains: async () => true },
    },
  });
  const service = await pairingService();
  const bundle = await settingsBundle();
  const { ExtensionService, Method } = await import(
    pathToFileURL(service.file).href
  );
  ExtensionService.getInstance().startListening();
  const trusted = { id: "test", url: "chrome-extension://test/popup.html" };
  const dispatch = async (
    method: string,
    data: object = {},
    sender: object = trusted,
  ) =>
    new Promise<Record<string, unknown>>((resolve) => {
      expect(
        listener?.({ method, ...data }, sender, (value) =>
          resolve(value as Record<string, unknown>),
        ),
      ).toBe(true);
    });
  let permissionAllowed = true;
  let permissionHold: Promise<void> | undefined;
  let permissionEntered: (() => void) | undefined;
  const requests: string[] = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on("console", (message) => logs.push(message.text()));
    await page.exposeFunction(
      "__askPairingPermission",
      async (value: { origins: string[] }) => {
        requests.push(value.origins[0]);
        permissionEntered?.();
        await permissionHold;
        return permissionAllowed;
      },
    );
    await page.exposeFunction(
      "__pairingBridge",
      async (method: string, data?: object) => {
        if (method === "KEYRING_STATUS")
          return {
            isInitialized: await keyring.isInitialized(),
            isUnlocked: keyring.isUnlocked(),
          };
        if (method === "ZKAS_HISTORY_GRANTS_LIST")
          return {
            account: {
              walletId: "",
              accountIndex: 0,
              address0: "",
              network: "mainnet",
            },
            records: [],
          };
        return dispatch(method, data);
      },
    );
    await page.addInitScript(
      "window.browser = { permissions: { request: (value) => window.__askPairingPermission(value) } };",
    );
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).pathname === "/settings.js")
        await route.fulfill({ contentType: "text/javascript", body: bundle });
      else
        await route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/settings.js"></script>',
        });
    });
    await page.goto("http://127.0.0.1:19455/settings.html");
    const section = page.getByRole("region", {
      name: "Daemon transport credential",
    });
    const input = page.getByLabel("Daemon bearer token");
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute("type", "password");
    const pair = page.getByRole("button", {
      name: "Save credential for this origin",
    });
    await input.fill(token);
    await pair.click();
    await expect(section).toContainText(
      "Credential saved. This does not connect the daemon yet.",
    );
    await expect(input).toHaveValue("");
    await expect(section).toContainText(`${origin}`);
    expect(requests).toEqual(["http://localhost/*"]);
    expect(JSON.stringify([...entries.values()])).not.toContain(token);
    expect(await section.textContent()).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    const store = new DaemonBearerStore(keyring);
    const before = (await store.list(async () => undefined))[0];
    entries.set("local:settings", {
      zkasDaemonUrls: { mainnet: "https://new.example" },
    });
    await page
      .getByRole("button", { name: "Refresh saved credentials" })
      .click();
    await expect(section).toContainText(
      "Source: stale. Credential saved only.",
    );
    entries.set("local:settings", {});
    await page
      .getByRole("button", { name: "Refresh saved credentials" })
      .click();
    await expect(section).toContainText(
      "Source: unconfigured. Credential saved only.",
    );
    const hostile = await dispatch(
      Method.ZKAS_DAEMON_BEARER_LIST,
      {},
      { id: "test", url: "https://site.example" },
    );
    expect(hostile.error).toBeTruthy();
    const replacement = await store.pair(
      origin,
      "b".repeat(64),
      async () => undefined,
    );
    await page.getByRole("button", { name: "Clear saved credential" }).click();
    await page.waitForTimeout(100);
    await expect(section.getByRole("alert")).toContainText(
      "Could not clear that saved revision",
    );
    expect((await store.list(async () => undefined))[0].revision).toBe(
      replacement.revision,
    );
    expect(replacement.revision).not.toBe(before.revision);
    await expect(section).toContainText(origin);
    await page.getByRole("button", { name: "Clear saved credential" }).click();
    await expect(section).toContainText("No saved daemon credentials.");
    permissionAllowed = false;
    await input.fill(token);
    await pair.click();
    await expect(section.getByRole("alert")).toContainText("Could not confirm");
    await expect(input).toHaveValue("");
    expect(await store.list(async () => undefined)).toEqual([]);
    permissionAllowed = true;
    let releasePermission!: () => void;
    permissionHold = new Promise<void>((resolve) => {
      releasePermission = resolve;
    });
    const enteredPermission = new Promise<void>((resolve) => {
      permissionEntered = resolve;
    });
    await input.fill(token);
    await pair.click();
    await enteredPermission;
    await page.getByLabel("Daemon URL").fill("https://different.example");
    releasePermission();
    await expect(input).toHaveValue("");
    await page.waitForTimeout(100);
    expect(await store.list(async () => undefined)).toEqual([]);
    await page.getByLabel("Daemon URL").fill(origin);
    permissionEntered = undefined;
    let releaseLockPermission!: () => void;
    permissionHold = new Promise<void>((resolve) => {
      releaseLockPermission = resolve;
    });
    const enteredLockPermission = new Promise<void>((resolve) => {
      permissionEntered = resolve;
    });
    await input.fill(token);
    await pair.click();
    await enteredLockPermission;
    await keyring.lock();
    releaseLockPermission();
    await expect(input).toBeDisabled({ timeout: 4_000 });
    await expect(store.list(async () => undefined)).rejects.toThrow();
    expect(await keyring.unlock("dummy-password")).toBe(true);
    expect(await store.list(async () => undefined)).toEqual([]);
    expect(await section.textContent()).not.toContain(token);
  } finally {
    await browser.close();
    service.cleanup();
  }
});

test("status waits cannot dispatch after draft changes and unmount clears the detached input", async () => {
  const fixture = await lifecycleFixture();
  try {
    let entered!: () => void;
    let release!: () => void;
    const reachedStatus = new Promise<void>((resolve) => (entered = resolve));
    const statusWait = new Promise<void>((resolve) => (release = resolve));
    fixture.holdStatus(() => {
      entered();
      return statusWait;
    });
    await fixture.input.fill(token);
    await fixture.page
      .getByRole("button", { name: "Save credential for this origin" })
      .click();
    await reachedStatus;
    await fixture.page.getByLabel("Review draft").fill("https://new.example");
    release();
    await fixture.page.waitForTimeout(100);
    await expect(fixture.input).toHaveValue("");
    await expect
      .poll(
        () =>
          fixture.calls.filter((item) => item === "ZKAS_DAEMON_BEARER_PAIR")
            .length,
      )
      .toBe(0);
    expect(await fixture.store.list(async () => undefined)).toEqual([]);

    await fixture.page.getByLabel("Review draft").fill(origin);
    await fixture.store.pair(origin, token, async () => undefined);
    await fixture.page
      .getByRole("button", { name: "Refresh saved credentials" })
      .click();
    await expect(
      fixture.page.getByRole("button", { name: "Clear saved credential" }),
    ).toBeVisible();
    let enteredClear!: () => void;
    let releaseClear!: () => void;
    const reachedClearStatus = new Promise<void>(
      (resolve) => (enteredClear = resolve),
    );
    const clearWait = new Promise<void>((resolve) => (releaseClear = resolve));
    fixture.holdStatus(() => {
      enteredClear();
      return clearWait;
    });
    await fixture.page
      .getByRole("button", { name: "Clear saved credential" })
      .click();
    await reachedClearStatus;
    await fixture.page
      .getByLabel("Review draft")
      .fill("https://different.example");
    releaseClear();
    await fixture.page.waitForTimeout(100);
    await expect
      .poll(
        () =>
          fixture.calls.filter((item) => item === "ZKAS_DAEMON_BEARER_CLEAR")
            .length,
      )
      .toBe(0);
    expect(await fixture.store.list(async () => undefined)).toHaveLength(1);

    await fixture.input.fill(token);
    const detached = await fixture.page.evaluate(() => {
      const node = document.getElementById(
        "zkas-daemon-bearer",
      ) as HTMLInputElement;
      (window as typeof window & { __unmount: () => void }).__unmount();
      return { valueEmpty: node.value === "", isConnected: node.isConnected };
    });
    expect(detached).toEqual({ valueEmpty: true, isConnected: false });
  } finally {
    await fixture.close();
  }
});

test("a delayed list response cannot replace a newer same-draft refresh", async () => {
  const fixture = await lifecycleFixture();
  try {
    const saved = await fixture.store.pair(
      origin,
      token,
      async () => undefined,
    );
    let entered!: () => void;
    let release!: () => void;
    const reachedList = new Promise<void>((resolve) => (entered = resolve));
    const listWait = new Promise<void>((resolve) => (release = resolve));
    fixture.holdList(() => {
      entered();
      return listWait;
    });
    await fixture.page
      .getByRole("button", { name: "Refresh saved credentials" })
      .click();
    await reachedList;
    await fixture.store.clear(origin, saved.revision, async () => undefined);
    await fixture.page
      .getByRole("button", { name: "Refresh saved credentials" })
      .click();
    const section = fixture.page.getByRole("region", {
      name: "Daemon transport credential",
    });
    await expect(section).toContainText("No saved daemon credentials.");
    release();
    await fixture.page.waitForTimeout(100);
    await expect(section).toContainText("No saved daemon credentials.");
  } finally {
    await fixture.close();
  }
});
