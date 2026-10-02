import { chromium, expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Keyring } from "@/lib/keyring-manager";
import {
  HistoryGrantPendingStore,
  isHistoryGrantPopupSender,
  type HistoryGrantPending,
} from "@/lib/zkas/history-grant-pending";

const context = {
  audience: { kind: "website" as const, origin: "https://messages.example" },
  walletId: "wallet-1",
  accountIndex: 0,
  address0:
    "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy",
  network: "mainnet" as const,
  genesis: "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f",
  daemonUrl: "http://localhost:8765",
  indexUrl: "http://127.0.0.1:8786",
};
const popupUrl =
  "chrome-extension://test/popup.html?approvalId=00000000-0000-4000-8000-000000000001#/zkas-history-grant";

function pending(): HistoryGrantPending {
  return {
    approvalId: "00000000-0000-4000-8000-000000000001",
    pageRequestId: "page-request",
    tabId: 8,
    frameId: 2,
    origin: "https://messages.example",
    context,
    keyringSession: 2,
    grantGeneration: 7,
    workerEpoch: "worker-a",
    createdAt: 1_000,
    state: "awaiting",
  };
}

function fixture(now = () => 1_000, epoch = "worker-a") {
  let saved: HistoryGrantPending | null = null;
  const adapter = {
    get: async () => saved,
    set: async (value: HistoryGrantPending | null) => {
      saved = value;
    },
  };
  return { store: new HistoryGrantPendingStore(adapter, now, epoch), adapter };
}

test("history consent is one pending request with browser-created popup identity", async () => {
  const { store } = fixture();
  await store.acquire(pending());
  await expect(
    store.acquire({ ...pending(), approvalId: crypto.randomUUID() }),
  ).rejects.toThrow();
  await store.bindPopup(pending().approvalId, 42, 43, popupUrl);
  const bound = await store.get(pending().approvalId);
  expect(bound?.popupWindowId).toBe(42);
  expect(bound?.popupTabId).toBe(43);
  const sender = {
    id: "test",
    url: popupUrl,
    tab: { id: 43, windowId: 42 },
    frameId: 0,
  };
  expect(isHistoryGrantPopupSender(bound!, sender, "test")).toBe(true);
  for (const invalid of [
    { ...sender, id: "foreign" },
    { ...sender, tab: { ...sender.tab, id: 44 } },
    { ...sender, tab: { ...sender.tab, windowId: 41 } },
    { ...sender, frameId: undefined },
    { ...sender, tab: undefined },
    { ...sender, url: popupUrl.replace("#/zkas-history-grant", "#/dashboard") },
  ]) {
    expect(isHistoryGrantPopupSender(bound!, invalid, "test")).toBe(false);
  }
});

test("restart, expiry and completion cannot revive an old history approval", async () => {
  const { store, adapter } = fixture();
  await store.acquire(pending());
  expect(
    await new HistoryGrantPendingStore(adapter, () => 1_001, "worker-b").get(
      pending().approvalId,
    ),
  ).toBeNull();
  expect(
    await new HistoryGrantPendingStore(adapter, () => 181_000, "worker-a").get(
      pending().approvalId,
    ),
  ).toBeNull();
  await store.bindPopup(pending().approvalId, 42, 43, popupUrl);
  await store.begin(pending().approvalId);
  await store.markCommitting(pending().approvalId);
  await store.finish(
    pending().approvalId,
    "00000000-0000-4000-8000-000000000002",
    false,
  );
  await expect(store.begin(pending().approvalId)).rejects.toThrow();
  expect((await store.get(pending().approvalId))?.state).toBe("finished");
  let revoked = false;
  await store.revokeFinished(pending().approvalId, async (value) => {
    expect(value.context).toEqual(context);
    revoked = true;
  });
  expect(revoked).toBe(true);
  expect(await store.get(pending().approvalId)).toBeNull();
});

test("cancel, popup close and timeout cannot clear a committing grant", async () => {
  const { store } = fixture();
  const request = pending();
  await store.acquire(request);
  await store.bindPopup(request.approvalId, 42, 43, popupUrl);
  expect((await store.cancel(request.approvalId))?.state).toBe("awaiting");
  await store.acquire(request);
  await store.bindPopup(request.approvalId, 42, 43, popupUrl);
  await store.begin(request.approvalId);
  expect((await store.takeByWindow(42))?.state).toBe("verifying");
  await store.acquire(request);
  await store.bindPopup(request.approvalId, 42, 43, popupUrl);
  await store.begin(request.approvalId);
  await store.markCommitting(request.approvalId);
  expect(await store.cancel(request.approvalId)).toBeNull();
  expect(await store.takeByWindow(42)).toBeNull();
  expect((await store.get(request.approvalId))?.state).toBe("committing");
  let revoked = false;
  await store.revokeFinished(request.approvalId, async () => {
    revoked = true;
  });
  expect(revoked).toBe(true);
  expect(await store.get(request.approvalId)).toBeNull();
});

async function buildRealHandlers() {
  const root = process.cwd();
  const mocks: Record<string, string> = {
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
    "@/lib/service/extension-service":
      "export const ExtensionService = { getInstance: () => ({ getKeyring: () => globalThis.__historyDeps.keyring }) };",
    "../extension-service":
      "export const ExtensionService = { getInstance: () => ({ getKeyring: () => globalThis.__historyDeps.keyring }) };",
    "@/lib/zkas/key-service":
      "export const zkasKeyService = { publicAccount: async () => globalThis.__historyDeps.account, checkSelection: async () => { if (globalThis.__historyDeps.selectionChanged) throw Error('selection changed') } };",
    "@/lib/zkas/connection":
      "export const zkasConnectionStore = { list: async () => globalThis.__historyDeps.connections }; export const hasZKasConnection = (items, origin) => items.includes(origin); export const isAllowedZKasDappOrigin = value => { try { const url = new URL(value); return url.origin === value && (url.protocol === 'https:' || url.hostname === 'localhost') } catch { return false } };",
    "./connection":
      "export const isAllowedZKasDappOrigin = value => { try { const url = new URL(value); return url.origin === value && url.protocol === 'https:' } catch { return false } };",
    "@/lib/zkas/selection":
      "export const sameZKasSelection = (a, b) => a.walletId === b.walletId && a.accountIndex === b.accountIndex && a.network === b.network;",
    "@/lib/wallet-network":
      "export const ZKAS_EXPERIMENTAL_KEY = 'local:zkas-enabled'; export const assertZKasActive = (settings, enabled) => { if (!settings || !enabled) throw Error('ZKas unavailable') };",
    "@/lib/utils":
      "export const POPUP_WINDOW_HEIGHT = 600; export const POPUP_WINDOW_WIDTH = 375;",
    "@/api/background/utils":
      "export const ApiUtils = { createApiResponse: (id, response, error) => ({ id, source: 'background', target: 'browser', response, ...(error ? { error } : {}) }) };",
  };
  const output = await build({
    entryPoints: ["history-flow-test-entry"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "history-test-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /^history-flow-test-entry$/ }, () => ({
            path: "entry",
            namespace: "test-entry",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "test-entry" }, () => ({
            contents: `export { zkasHistoryGrantHandler } from ${JSON.stringify(resolve(root, "api/background/handlers/zkas/history-grant.ts"))};\nexport { zkasHistoryGrantComplete, zkasHistoryGrantPendingGet } from ${JSON.stringify(resolve(root, "lib/service/handlers/zkas-history-grant.ts"))};\nexport { historyGrantPendingStore } from ${JSON.stringify(resolve(root, "lib/zkas/history-grant-pending.ts"))};`,
            loader: "js",
            resolveDir: root,
          }));
          plugin.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "test-mock" }
              : { path: resolve(root, `${args.path.slice(2)}.ts`) },
          );
          plugin.onResolve({ filter: /^\.\.\/extension-service$/ }, () => ({
            path: "../extension-service",
            namespace: "test-mock",
          }));
          plugin.onResolve({ filter: /^\.\/connection$/ }, (args) =>
            args.importer.endsWith("history-grant.ts")
              ? { path: "./connection", namespace: "test-mock" }
              : null,
          );
          plugin.onLoad({ filter: /.*/, namespace: "test-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const directory = mkdtempSync(join(tmpdir(), "kastle-history-flow-"));
  const file = join(directory, "handlers.mjs");
  writeFileSync(file, output.outputFiles[0].contents);
  stop();
  return {
    file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("real background and popup handlers challenge the original frame, commit and revoke encrypted consent", async () => {
  const artifact = await buildRealHandlers();
  try {
    const runner = `
      import assert from 'node:assert/strict';
      const context = ${JSON.stringify(context)};
      const values = new Map();
      globalThis.storage = {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
        removeItem: async key => { values.delete(key); },
      };
      class TestKeyring {
        generation = 0; current = null; session = 1;
        isUnlocked() { return true; }
        getSessionVersion() { return this.session; }
        getMutationGeneration() { return this.generation; }
        async getValue() { return this.current; }
        async updateValue(_key, update) { this.current = await update(this.current); this.generation++; }
        async updateValueIfGeneration(_key, expected, update) {
          if (this.generation !== expected) throw Error('grant changed');
          const next = await update(this.current);
          if (this.generation !== expected) throw Error('grant changed');
          this.current = next; return ++this.generation;
        }
        async removeValue() { this.current = null; this.generation++; }
      }
      const keyring = new TestKeyring();
      const deps = {
        keyring,
        account: { walletId: context.walletId, accountIndex: context.accountIndex, network: 'mainnet', address: context.address0 },
        connections: [context.audience.origin], selectionChanged: false,
        challengeOrigin: context.audience.origin,
        resultAcknowledged: true, mutateDuringChallenge: false,
      };
      globalThis.__historyDeps = deps;
      values.set('local:settings', { zkasDaemonUrls: { mainnet: context.daemonUrl }, zkasHistoryIndexUrls: { mainnet: context.indexUrl } });
      values.set('local:zkas-enabled', true);
      const sent = [];
      globalThis.browser = {
        runtime: { id: 'test', getURL: path => 'chrome-extension://test' + path },
        windows: { create: async () => ({ id: 42, tabs: [{ id: 43, windowId: 42 }] }), get: async () => ({ id: 42, tabs: [{ id: 43, windowId: 42 }] }), remove: async () => {} },
        alarms: { create: async () => {}, clear: async () => true },
        tabs: { sendMessage: async (_id, message) => {
          sent.push(message);
          if (message.kind === 'ZKAS_HISTORY_ORIGIN_CHALLENGE') {
            if (deps.mutateDuringChallenge) await keyring.removeValue('zkasHistoryGrants');
            return { nonce: message.nonce, origin: deps.challengeOrigin };
          }
          if (message.response.response?.granted === true)
            assert.equal(values.get('session:zkas-history-grant-pending')?.state, 'finished', 'grant must be recorded before page delivery');
          return { accepted: deps.resultAcknowledged, origin: context.audience.origin };
        } },
      };
      const handlers = await import(${JSON.stringify(`file://${artifact.file}`)});
      async function request(pageId) {
        const replies = [];
        await handlers.zkasHistoryGrantHandler(8, { id: pageId, origin: context.audience.origin }, value => replies.push(value), { id: 'test', url: context.audience.origin + '/page', tab: { id: 8 }, frameId: 2 });
        assert.equal(replies[0].response.pending, true);
        const record = values.get('session:zkas-history-grant-pending');
        return { id: record.approvalId, sender: { id: 'test', url: record.popupUrl, origin: 'chrome-extension://test', tab: { id: 43, windowId: 42 }, frameId: 0 } };
      }
      const first = await request('page-1');
      const view = [];
      await handlers.zkasHistoryGrantPendingGet({ approvalId: first.id }, value => view.push(value), first.sender);
      assert.equal(view[0].origin, context.audience.origin);
      await assert.rejects(handlers.zkasHistoryGrantComplete({ approvalId: first.id, decision: 'approve' }, () => {}, { ...first.sender, tab: { id: 99, windowId: 42 } }));
      const approved = [];
      await handlers.zkasHistoryGrantComplete({ approvalId: first.id, decision: 'approve' }, value => approved.push(value), first.sender);
      assert.deepEqual(approved, [{ committed: true, delivered: true }]);
      assert.deepEqual(sent.map(value => value.kind), ['ZKAS_HISTORY_ORIGIN_CHALLENGE', 'ZKAS_DAPP_RESULT']);
      assert.equal(keyring.current.records.length, 1);
      const revoked = [];
      await handlers.zkasHistoryGrantComplete({ approvalId: first.id, decision: 'revoke' }, value => revoked.push(value), first.sender);
      assert.deepEqual(revoked, [{ revoked: true }]);
      assert.equal(keyring.current.records.length, 0);
      await assert.rejects(handlers.zkasHistoryGrantComplete({ approvalId: first.id, decision: 'approve' }, () => {}, first.sender));
      const second = await request('page-2');
      await keyring.removeValue('zkasHistoryGrants');
      const stale = [];
      await handlers.zkasHistoryGrantComplete({ approvalId: second.id, decision: 'approve' }, value => stale.push(value), second.sender);
      assert.equal(stale[0].committed, false);
      assert.equal(keyring.current, null);
      const third = await request('page-3');
      deps.challengeOrigin = 'https://navigated.example';
      const navigated = [];
      await handlers.zkasHistoryGrantComplete({ approvalId: third.id, decision: 'approve' }, value => navigated.push(value), third.sender);
      assert.equal(navigated[0].committed, false);
      assert.equal(keyring.current, null);
      const fourth = await request('page-4');
      deps.challengeOrigin = context.audience.origin;
      deps.mutateDuringChallenge = true;
      const raced = [];
      await handlers.zkasHistoryGrantComplete({ approvalId: fourth.id, decision: 'approve' }, value => raced.push(value), fourth.sender);
      assert.equal(raced[0].committed, false);
      assert.equal(keyring.current, null);
      deps.mutateDuringChallenge = false;
      const fifth = await request('page-5');
      deps.resultAcknowledged = false;
      const undelivered = [];
      await handlers.zkasHistoryGrantComplete({ approvalId: fifth.id, decision: 'approve' }, value => undelivered.push(value), fifth.sender);
      assert.deepEqual(undelivered, [{ committed: true, delivered: false }]);
      assert.equal(values.get('session:zkas-history-grant-pending').state, 'finished');
      await handlers.zkasHistoryGrantComplete({ approvalId: fifth.id, decision: 'revoke' }, () => {}, fifth.sender);
      assert.equal(keyring.current.records.length, 0);
      console.log('PASS route, popup, challenge, revoke, stale-generation, navigation, pre-delivery record, lost delivery');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: runner,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "PASS route, popup, challenge, revoke, stale-generation, navigation, pre-delivery record, lost delivery",
    );
  } finally {
    artifact.cleanup();
  }
});

test("a reloaded committing popup can revoke consent after both finish writes fail", async () => {
  const artifact = await buildRealHandlers();
  const root = process.cwd();
  const popupBundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import Popup from './components/screens/browser-api/zkas/ZKasHistoryGrant';
        createRoot(document.getElementById('root')).render(<Popup />);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "history-popup-test-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\// }, (args) =>
            args.path === "@/components/GeneralHeader" ||
            args.path === "@/lib/utils"
              ? { path: args.path, namespace: "popup-test-mock" }
              : { path: resolve(root, `${args.path.slice(2)}.ts`) },
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "popup-test-mock" },
            (args) => ({
              contents:
                args.path === "@/components/GeneralHeader"
                  ? "export default function Header() { return null; }"
                  : "export const sendMessage = (method, data) => window.__historyGrantBridge(method, data);",
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  stop();

  const values = new Map<string, unknown>();
  let failedFinishWrites = 0;
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: { state?: string } | null) => {
        if (
          key === "session:zkas-history-grant-pending" &&
          value?.state === "finished"
        ) {
          failedFinishWrites += 1;
          throw new Error("finish storage unavailable");
        }
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    },
  });
  const keyringNamespace = `history-reload-${crypto.randomUUID()}`;
  const keyring = new Keyring(keyringNamespace);
  await keyring.initialize("public-fixture-password");
  Object.assign(globalThis, {
    __historyDeps: {
      keyring,
      account: {
        walletId: context.walletId,
        accountIndex: context.accountIndex,
        network: context.network,
        address: context.address0,
      },
      connections: [context.audience.origin],
    },
  });
  values.set("local:settings", {
    zkasDaemonUrls: { mainnet: context.daemonUrl },
    zkasHistoryIndexUrls: { mainnet: context.indexUrl },
  });
  values.set("local:zkas-enabled", true);
  Object.assign(globalThis, {
    browser: {
      runtime: {
        id: "test",
        getURL: (path: string) => `chrome-extension://test${path}`,
      },
      windows: {
        create: async () => ({ id: 42, tabs: [{ id: 43, windowId: 42 }] }),
        get: async () => ({ id: 42, tabs: [{ id: 43, windowId: 42 }] }),
        remove: async () => {},
      },
      alarms: { create: async () => {}, clear: async () => true },
      tabs: {
        sendMessage: async (
          _id: number,
          message: { kind?: string; nonce?: string },
        ) =>
          message.kind === "ZKAS_HISTORY_ORIGIN_CHALLENGE"
            ? { nonce: message.nonce, origin: context.audience.origin }
            : { accepted: true, origin: context.audience.origin },
      },
    },
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  try {
    const handlers = await import(pathToFileURL(artifact.file).href);
    const responses: Array<{ response?: { pending?: boolean } }> = [];
    await handlers.zkasHistoryGrantHandler(
      8,
      { id: "page-request", origin: context.audience.origin },
      (value: { response?: { pending?: boolean } }) => responses.push(value),
      {
        id: "test",
        url: `${context.audience.origin}/page`,
        tab: { id: 8 },
        frameId: 2,
      },
    );
    expect(responses[0].response?.pending).toBe(true);
    const record = values.get(
      "session:zkas-history-grant-pending",
    ) as HistoryGrantPending;
    const sender = {
      id: "test",
      url: record.popupUrl,
      origin: "chrome-extension://test",
      tab: { id: 43, windowId: 42 },
      frameId: 0,
    };
    const result: Array<{ committed: boolean; reviewRequired: boolean }> = [];
    await handlers.zkasHistoryGrantComplete(
      { approvalId: record.approvalId, decision: "approve" },
      (value: { committed: boolean; reviewRequired: boolean }) =>
        result.push(value),
      sender,
    );
    expect(result).toEqual([
      { committed: false, delivered: false, reviewRequired: true },
    ]);
    expect(failedFinishWrites).toBe(2);
    expect(
      (await keyring.getValue<{ records: unknown[] }>("zkasHistoryGrants"))
        ?.records,
    ).toHaveLength(1);
    const encrypted = values.get(`local:${keyringNamespace}:zkasHistoryGrants`);
    expect(JSON.stringify(encrypted)).not.toContain(context.audience.origin);
    expect(
      (values.get("session:zkas-history-grant-pending") as HistoryGrantPending)
        .state,
    ).toBe("committing");

    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.exposeFunction(
      "__historyGrantBridge",
      async (method: string, data: object) => {
        const handler = method.endsWith("PENDING_GET")
          ? handlers.zkasHistoryGrantPendingGet
          : handlers.zkasHistoryGrantComplete;
        let response: unknown;
        await handler(
          data,
          (value: unknown) => {
            response = value;
          },
          sender,
        );
        return response;
      },
    );
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).pathname === "/popup.js") {
        await route.fulfill({
          contentType: "text/javascript",
          body: popupBundle.outputFiles[0].text,
        });
      } else {
        await route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/popup.js"></script>',
        });
      }
    });
    await page.goto(
      `http://127.0.0.1:19452/popup.html?approvalId=${record.approvalId}#/zkas-history-grant`,
    );
    await expect(page.getByText(context.audience.origin)).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "could not confirm whether access was saved",
    );
    await expect(
      page.getByRole("button", { name: "Approve message history" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await page
      .getByRole("button", { name: "Revoke this website's access" })
      .click();
    await expect(page.getByRole("status")).toContainText("revoked");
    expect(
      (await keyring.getValue<{ records: unknown[] }>("zkasHistoryGrants"))
        ?.records,
    ).toHaveLength(0);
    expect(values.get("session:zkas-history-grant-pending")).toBeNull();
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
    artifact.cleanup();
  }
});

test("content script answers only the current-origin challenge and filters final delivery", async () => {
  const root = process.cwd();
  const output = await build({
    entryPoints: [resolve(root, "entrypoints/content.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "content-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\// }, (args) =>
            args.path === "@/api/message"
              ? { path: resolve(root, "api/message.ts") }
              : { path: args.path, namespace: "content-mock" },
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "content-mock" },
            (args) => ({
              contents: args.path.endsWith("zkas-page-message")
                ? "export const isTrustedZKasPageMessage = (source, origin, win) => source === win && origin === win.location.origin;"
                : args.path.includes("listeners/ethereum/")
                  ? `export class ${args.path.includes("accountsChanged") ? "EthereumAccountsChangedListener" : "EthereumChainChangedListener"} { start() {} }`
                  : "export const watchSettingsUpdated = () => {}; export const watchWalletSettingsUpdated = () => {};",
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const directory = mkdtempSync(join(tmpdir(), "kastle-history-content-"));
  try {
    const file = join(directory, "content.mjs");
    writeFileSync(file, output.outputFiles[0].contents);
    const runner = `
      import assert from 'node:assert/strict';
      const posted = [];
      let listener;
      globalThis.window = { location: { origin: 'https://messages.example', host: 'messages.example' }, addEventListener() {}, postMessage(value) { posted.push(value); }, dispatchEvent() {} };
      globalThis.Event = class { constructor(type) { this.type = type; } };
      globalThis.defineContentScript = config => config;
      globalThis.browser = { runtime: { id: 'extension-a', onMessage: { addListener(callback) { listener = callback; } } } };
      const module = await import(${JSON.stringify(`file://${file}`)});
      module.default.main();
      const nonce = 'a'.repeat(64);
      const challenge = { kind: 'ZKAS_HISTORY_ORIGIN_CHALLENGE', origin: 'https://messages.example', nonce };
      let answer;
      listener(challenge, { id: 'foreign' }, value => answer = value);
      assert.equal(answer, null);
      listener(challenge, { id: 'extension-a' }, value => answer = value);
      assert.deepEqual(answer, { nonce, origin: 'https://messages.example' });
      window.location.origin = 'https://navigated.example';
      listener(challenge, { id: 'extension-a' }, value => answer = value);
      assert.equal(answer, null);
      const response = { id: 'request', source: 'background', target: 'browser', response: { granted: true } };
      listener({ kind: 'ZKAS_DAPP_RESULT', origin: 'https://messages.example', response }, { id: 'extension-a' }, value => answer = value);
      assert.deepEqual(answer, { accepted: false });
      assert.equal(posted.length, 0);
      console.log('PASS content origin challenge and final filter');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: runner,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "PASS content origin challenge and final filter",
    );
  } finally {
    stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
