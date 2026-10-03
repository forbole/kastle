import { expect, test } from "@playwright/test";
import { Method } from "@/lib/service/methods";
import { Keyring } from "@/lib/keyring-manager";
import { DaemonBearerStore } from "@/lib/zkas/daemon-bearer";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";

const origin = "http://localhost:8765";
const bearer = "a".repeat(64);
const fvk = "b".repeat(192);
const account = {
  walletId: "wallet-1",
  accountIndex: 0,
  network: "mainnet" as const,
  address: "zkas:dummy-address",
};

async function builtTransport() {
  const result = await build({
    entryPoints: [resolve("lib/service/handlers/zkas-daemon-transport.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "private-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/lib\/zkas\/key-service$/ }, () => ({
            path: "key-service",
            namespace: "private-mock",
          }));
          plugin.onResolve(
            { filter: /^@\/contexts\/SettingsContext$/ },
            () => ({ path: "settings", namespace: "private-mock" }),
          );
          plugin.onResolve({ filter: /^\.\.\/extension-service$/ }, () => ({
            path: "extension-service",
            namespace: "private-mock",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "private-mock" },
            (args) => ({
              contents:
                args.path === "extension-service"
                  ? "export const ExtensionService={getInstance:()=>({getKeyring:()=>globalThis.__privateDeps.keyring})};"
                  : args.path === "settings"
                    ? "export const SETTINGS_KEY='local:settings';"
                    : "export const zkasKeyService={credentials:async()=>globalThis.__privateDeps.credentials(),checkSelection:async()=>globalThis.__privateDeps.checkSelection(),sign:async(input)=>globalThis.__privateDeps.sign(input)};",
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), "zkas-private-transport-"));
  const file = join(dir, "transport.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  stop();
  return {
    module: (await import(
      pathToFileURL(file).href
    )) as typeof import("@/lib/service/handlers/zkas-daemon-transport"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function builtPopup() {
  const result = await build({
    entryPoints: [resolve("lib/zkas/popup-client.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "message-boundary",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({
            path: "utils",
            namespace: "popup-mock",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "popup-mock" }, () => ({
            contents:
              "export const sendMessage=(method,data)=>globalThis.__popupDispatch(method,data);",
            loader: "js",
          }));
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), "zkas-popup-transport-"));
  const file = join(dir, "popup.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  stop();
  return {
    module: (await import(
      pathToFileURL(file).href
    )) as typeof import("@/lib/zkas/popup-client"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function builtPageBalance() {
  const result = await build({
    entryPoints: [resolve("api/background/handlers/zkas/get-balance.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "page-balance-boundaries",
        setup(plugin) {
          const mocks: Record<string, string> = {
            "@/api/background/utils":
              "export const ApiUtils={createApiResponse:(id,response)=>({id,response})};",
            "@/lib/zkas/connection":
              "export const zkasConnectionStore={list:async()=>globalThis.__pageDeps.connections};export const hasZKasConnection=(rows,origin)=>rows.includes(origin);",
            "@/lib/zkas/key-service":
              "export const zkasKeyService={publicAccount:async()=>globalThis.__pageDeps.account};",
            "@/lib/service/handlers/zkas-daemon-transport":
              "export const privateDaemonWebsiteBalance=async(account,origin,publish)=>{const state=await globalThis.__pageDeps.state(account);if(!globalThis.__pageDeps.connections.includes(origin))throw new Error('Connect this website to ZKas first');publish({...state,balanceSompi:state.balanceSompi.toString(),network:account.network});};",
          };
          plugin.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "page-mock" }
              : undefined,
          );
          plugin.onLoad({ filter: /.*/, namespace: "page-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), "zkas-page-balance-"));
  const file = join(dir, "balance.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  stop();
  return {
    module: (await import(
      pathToFileURL(file).href
    )) as typeof import("@/api/background/handlers/zkas/get-balance"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function builtCombinedPage() {
  const mocks: Record<string, string> = {
    "@/api/background/utils":
      "export const ApiUtils={createApiResponse:(id,response)=>({id,response})};",
    "@/contexts/SettingsContext": "export const SETTINGS_KEY='local:settings';",
    "../extension-service":
      "export const ExtensionService={getInstance:()=>({getKeyring:()=>globalThis.__privateDeps.keyring})};",
    "@/lib/zkas/key-service":
      "export const zkasKeyService={publicAccount:async()=>globalThis.__reviewAccount,credentials:async()=>globalThis.__privateDeps.credentials(),checkSelection:async(...args)=>globalThis.__privateDeps.checkSelection(...args)};",
  };
  const result = await build({
    stdin: {
      contents: `export { zkasGetBalanceHandler } from "${resolve("api/background/handlers/zkas/get-balance.ts")}";
export { zkasConnectionStore } from "${resolve("lib/zkas/connection.ts")}";`,
      resolveDir: resolve("."),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "combined-page-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "combined-mock" }
              : undefined,
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "combined-mock" },
            (args) => ({
              contents: mocks[args.path],
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), "zkas-combined-page-"));
  const file = join(dir, "page.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  stop();
  return {
    module: (await import(
      pathToFileURL(file).href
    )) as typeof import("@/api/background/handlers/zkas/get-balance") & {
      zkasConnectionStore: typeof import("@/lib/zkas/connection").zkasConnectionStore;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function builtDispatcher() {
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
    "zkasDaemonBearerPair",
    "zkasDaemonBearerList",
    "zkasDaemonBearerClear",
    "zkasPaymentSendOrdinary",
    "zkasPaymentSendWebsite",
    "zkasDirectActionComplete",
    "zkasDirectActionPendingGet",
  ];
  const result = await build({
    entryPoints: [resolve("lib/service/extension-service.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "trusted-dispatcher-boundary",
        setup(plugin) {
          plugin.onResolve({ filter: /handlers\// }, (args) =>
            args.path.includes("zkas-daemon-transport")
              ? null
              : { path: "unused", namespace: "dispatcher-mock" },
          );
          plugin.onResolve({ filter: /^@\/lib\/keyring-manager\.ts$/ }, () => ({
            path: "keyring",
            namespace: "dispatcher-mock",
          }));
          plugin.onResolve(
            { filter: /^@\/lib\/auto-lock-manager\.ts$/ },
            () => ({ path: "autolock", namespace: "dispatcher-mock" }),
          );
          plugin.onResolve({ filter: /^@\/lib\/zkas\/key-service$/ }, () => ({
            path: "key-service",
            namespace: "dispatcher-mock",
          }));
          plugin.onResolve(
            { filter: /^@\/contexts\/SettingsContext$/ },
            () => ({ path: "settings", namespace: "dispatcher-mock" }),
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "dispatcher-mock" },
            (args) => ({
              contents:
                args.path === "unused"
                  ? unused
                      .map((name) => `export const ${name}=async()=>{};`)
                      .join("\n")
                  : args.path === "keyring"
                    ? "export class Keyring {constructor(){return globalThis.__privateDeps.keyring;}}"
                    : args.path === "autolock"
                      ? "export class AutoLockManager {listen(){}}"
                      : args.path === "settings"
                        ? "export const SETTINGS_KEY='local:settings';"
                        : "export const zkasKeyService={credentials:async()=>globalThis.__privateDeps.credentials(),checkSelection:async()=>globalThis.__privateDeps.checkSelection()};",
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), "zkas-private-dispatcher-"));
  const file = join(dir, "dispatcher.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  stop();
  return {
    module: (await import(
      pathToFileURL(file).href
    )) as typeof import("@/lib/service/extension-service"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function fixture(targetOrigin = origin) {
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
  const keyring = new Keyring(`private-transport-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  values.set("local:settings", {
    networkId: "mainnet",
    zkasDaemonUrls: { mainnet: targetOrigin },
  });
  let permitted = true;
  let sourceChangedAfterFetch = false;
  let lockedAfterFetch = false;
  let permissionChangedAfterFetch = false;
  let bearerChangedAfterFetch = false;
  let unauthorized = false;
  let oversized = false;
  const calls: {
    path: string;
    authorization: string | null;
    token: string | null;
    body?: string;
  }[] = [];
  Object.assign(globalThis, {
    browser: { permissions: { contains: async () => permitted } },
    __privateDeps: {
      keyring,
      credentials: async () => ({
        ...account,
        keyringVersion: keyring.getSessionVersion(),
        fullViewingKeyHex: fvk,
        walletToken: "c".repeat(32),
        daemonUrl: targetOrigin,
      }),
      checkSelection: async () => {
        if (!keyring.isUnlocked()) throw new Error("Selected wallet changed");
      },
      sign: async () => [{ index: 0, sig: "e".repeat(128) }],
    },
  });
  const originalFetch = globalThis.fetch;
  let useRealFetch = false;
  globalThis.fetch = async (input, init) => {
    if (useRealFetch) return originalFetch(input, init);
    const path =
      new URL(String(input)).pathname + new URL(String(input)).search;
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      authorization: headers.get("Authorization"),
      token: headers.get("X-Wallet-Token"),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (sourceChangedAfterFetch)
      values.set("local:settings", {
        networkId: "mainnet",
        zkasDaemonUrls: { mainnet: "https://other.example" },
      });
    if (lockedAfterFetch) await keyring.lock();
    if (permissionChangedAfterFetch) permitted = false;
    if (bearerChangedAfterFetch)
      await new DaemonBearerStore(keyring).pair(
        targetOrigin,
        "d".repeat(64),
        async () => undefined,
      );
    if (unauthorized) return new Response("", { status: 401 });
    if (oversized) return new Response("x".repeat(524_289), { status: 200 });
    const response =
      path === "/api/status"
        ? {
            has_wallet: false,
            address: null,
            network: "mainnet",
            node_connected: true,
            daa_score: 765,
            synced: true,
          }
        : path === "/api/wallet/watch"
          ? { address: account.address }
          : path === "/api/wallet/balance"
            ? { balance_sompi: "42" }
            : path === "/api/wallet/history?limit=30"
              ? { recoverableHistory: true, total: 0, rows: [] }
              : { unexpected: true };
    return new Response(JSON.stringify(response), { status: 200 });
  };
  const built = await builtTransport();
  const pair = () =>
    new DaemonBearerStore(keyring).pair(
      targetOrigin,
      bearer,
      async () => undefined,
    );
  const invoke = async (
    method: (
      message: never,
      respond: (value: unknown) => void,
    ) => Promise<void>,
    message: object,
  ) => {
    let response: unknown;
    await method(message as never, (value) => {
      response = value;
    });
    return response;
  };
  return {
    ...built,
    keyring,
    calls,
    values,
    pair,
    invoke,
    setSourceChange: () => {
      sourceChangedAfterFetch = true;
    },
    setLockChange: () => {
      lockedAfterFetch = true;
    },
    setPermissionChange: () => {
      permissionChangedAfterFetch = true;
    },
    setBearerChange: () => {
      bearerChangedAfterFetch = true;
    },
    setPermission: (value: boolean) => {
      permitted = value;
    },
    setUnauthorized: () => {
      unauthorized = true;
    },
    setOversized: () => {
      oversized = true;
    },
    useRealFetch: () => {
      useRealFetch = true;
    },
    cleanup: () => {
      globalThis.fetch = originalFetch;
      built.cleanup();
    },
  };
}

test("read and setup have only four named internal operations", () => {
  expect(Method.ZKAS_DAEMON_BIRTHDAY).toBe("ZKAS_DAEMON_BIRTHDAY");
  expect(Method.ZKAS_DAEMON_REGISTER).toBe("ZKAS_DAEMON_REGISTER");
  expect(Method.ZKAS_DAEMON_STATE).toBe("ZKAS_DAEMON_STATE");
  expect(Method.ZKAS_DAEMON_RECENT_HISTORY).toBe("ZKAS_DAEMON_RECENT_HISTORY");
  expect(Object.values(Method)).not.toContain("ZKAS_DAEMON_REQUEST");
});

test("registration binds the chosen history index before sharing a viewing key", async () => {
  const flow = await fixture();
  try {
    flow.values.set("local:settings", {
      networkId: "mainnet",
      zkasDaemonUrls: { mainnet: origin },
      zkasHistoryIndexUrls: { mainnet: "https://index.example" },
    });
    const request = {
      method: Method.ZKAS_DAEMON_REGISTER,
      expectedAccount: account,
      expectedOrigin: origin,
      expectedIndexOrigin: "https://index.example",
      birthday: 0,
    };
    expect(await flow.invoke(flow.module.daemonRegister, request)).toEqual({
      registered: true,
    });
    expect(flow.calls.some((call) => call.path === "/api/wallet/watch")).toBe(
      true,
    );
    flow.calls.length = 0;
    flow.values.set("local:settings", {
      networkId: "mainnet",
      zkasDaemonUrls: { mainnet: origin },
      zkasHistoryIndexUrls: { mainnet: "https://different.example" },
    });
    await expect(
      flow.invoke(flow.module.daemonRegister, request),
    ).rejects.toThrow();
    expect(flow.calls).toHaveLength(0);
  } finally {
    flow.cleanup();
  }
});

test("private single payment uses paired bearer and returns only its actual result", async () => {
  const flow = await fixture();
  const txid = "f".repeat(64);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/wallet/prepare")
      return new Response(
        JSON.stringify({
          session: "b".repeat(32),
          bundle_hex: "aa",
          amount_sompi_exact: "1",
          fee_sompi_exact: "1",
          remaining_sompi_exact: "0",
          disclosure: [],
          spend_auth: [],
        }),
      );
    if (path === "/api/wallet/submit")
      return new Response(
        JSON.stringify({ txid, amount_sompi_exact: "1", fee_sompi_exact: "1" }),
      );
    return originalFetch(input, init);
  };
  try {
    await flow.pair();
    const result = await flow.module.privateDaemonPayment(
      account,
      {
        to: "zkas:recipient",
        amountSompi: 1n,
        maxFeeSompi: 2n,
        memo: "memo",
      },
      {
        beforeSubmit: async () => undefined,
        onSubmitted: async () => undefined,
      },
    );
    expect(result.txid).toBe(txid);
    expect(result.daemonReportedFeeSompi).toBe(1n);
    const visible = JSON.stringify(result, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(visible).not.toContain(fvk);
    expect(visible).not.toContain(bearer);
  } finally {
    flow.cleanup();
  }
});

test("popup read/setup methods send only public expected facts and receive no credentials", async () => {
  const requests: { method: Method; data: object }[] = [];
  Object.assign(globalThis, {
    browser: { permissions: { contains: async () => true } },
    __popupDispatch: async (method: Method, data: object) => {
      requests.push({ method, data });
      if (method === Method.ZKAS_DAEMON_BIRTHDAY) return { birthday: 765 };
      if (method === Method.ZKAS_DAEMON_REGISTER) return { registered: true };
      if (method === Method.ZKAS_DAEMON_STATE)
        return {
          address: account.address,
          balanceSompi: "42",
          synced: true,
          missingHistory: false,
        };
      if (method === Method.ZKAS_DAEMON_RECENT_HISTORY)
        return { recoverableHistory: true, total: 0, rows: [] };
      throw new Error("Unexpected private method");
    },
  });
  const popup = await builtPopup();
  try {
    expect(await popup.module.getZKasDaemonBirthday(origin)).toBe(765);
    await popup.module.registerSelectedZKasWallet(account, origin, 700);
    expect((await popup.module.getZKasState(account)).balanceSompi).toBe(42n);
    expect(await popup.module.getZKasHistory()).toMatchObject({
      total: 0,
      rows: [],
    });
    expect(requests.map((row) => row.method)).toEqual([
      Method.ZKAS_DAEMON_BIRTHDAY,
      Method.ZKAS_DAEMON_REGISTER,
      Method.ZKAS_DAEMON_STATE,
      Method.ZKAS_DAEMON_RECENT_HISTORY,
    ]);
    expect(requests[1].data).toMatchObject({
      expectedAccount: account,
      expectedOrigin: origin,
      birthday: 700,
    });
    expect(JSON.stringify(requests)).not.toContain(fvk);
    expect(JSON.stringify(requests)).not.toContain(bearer);
  } finally {
    popup.cleanup();
  }
});

test("ordinary and website payment popup calls carry only reviewed public facts", async () => {
  const requests: { method: Method; data: object }[] = [];
  Object.assign(globalThis, {
    __popupDispatch: async (method: Method, data: object) => {
      requests.push({ method, data });
      return {
        status: "submitted",
        txid: "a".repeat(64),
        daemonReportedFeeSompi: "7",
      };
    },
  });
  const popup = await builtPopup();
  try {
    await popup.module.sendZKasPayment({
      to: "zkas:recipient",
      amount: "1",
      maxFee: "0.1",
      memo: "hello",
      expectedAccount: account,
    });
    await popup.module.sendApprovedZKasWebsitePayment(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(requests).toEqual([
      {
        method: Method.ZKAS_PAYMENT_SEND_ORDINARY,
        data: {
          to: "zkas:recipient",
          amountSompi: "100000000",
          maxFeeSompi: "10000000",
          memo: "hello",
          expectedAccount: account,
        },
      },
      {
        method: Method.ZKAS_PAYMENT_SEND_WEBSITE,
        data: { approvalId: "11111111-1111-4111-8111-111111111111" },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain(fvk);
    expect(JSON.stringify(requests)).not.toContain(bearer);
  } finally {
    popup.cleanup();
  }
});

test("website balance keeps connection gates around private read and returns public fields", async () => {
  const page = await builtPageBalance();
  const website = "https://dapp.example";
  const deps = {
    account,
    connections: [] as string[],
    state: async () => ({
      address: account.address,
      balanceSompi: 42n,
      synced: true,
      missingHistory: false,
    }),
  };
  Object.assign(globalThis, { __pageDeps: deps });
  const responses: unknown[] = [];
  const request = { id: "dummy", origin: website };
  const invoke = () =>
    page.module.zkasGetBalanceHandler(
      1,
      request as never,
      (value: unknown) => responses.push(value),
      undefined as never,
    );
  try {
    await expect(invoke()).rejects.toThrow(/Connect/);
    expect(responses).toHaveLength(0);
    deps.connections.push(website);
    deps.state = async () => {
      deps.connections.length = 0;
      return {
        address: account.address,
        balanceSompi: 42n,
        synced: true,
        missingHistory: false,
      };
    };
    await expect(invoke()).rejects.toThrow(/Connect/);
    expect(responses).toHaveLength(0);
    deps.connections.push(website);
    deps.state = async () => ({
      address: account.address,
      balanceSompi: 42n,
      synced: true,
      missingHistory: false,
    });
    await invoke();
    expect(responses).toEqual([
      {
        id: "dummy",
        response: {
          address: account.address,
          network: "mainnet",
          balanceSompi: "42",
          synced: true,
          missingHistory: false,
        },
      },
    ]);
    expect(JSON.stringify(responses)).not.toContain(fvk);
    expect(JSON.stringify(responses)).not.toContain(bearer);
  } finally {
    page.cleanup();
  }
});

test("connected website revocation after status prevents the later private watch", async () => {
  const flow = await fixture();
  const page = await builtCombinedPage();
  const website = "https://dapp.example";
  Object.assign(globalThis, { __reviewAccount: account });
  flow.values.set("local:zkas-connections", { [website]: [account] });
  await flow.pair();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (String(input).endsWith("/api/status"))
      flow.values.set("local:zkas-connections", {});
    return response;
  };
  const responses: unknown[] = [];
  try {
    await expect(
      page.module.zkasGetBalanceHandler(
        1,
        { id: "revoked", origin: website } as never,
        (value) => responses.push(value),
        undefined as never,
      ),
    ).rejects.toThrow();
    expect(flow.calls.map((call) => call.path)).toEqual(["/api/status"]);
    expect(responses).toHaveLength(0);
  } finally {
    page.cleanup();
    flow.cleanup();
  }
});

for (const writeFails of [false, true]) {
  test(`revocation starting after balance blocks success even when its storage write ${writeFails ? "fails" : "succeeds"}`, async () => {
    const flow = await fixture();
    const page = await builtCombinedPage();
    const website = "https://dapp.example";
    Object.assign(globalThis, { __reviewAccount: account });
    flow.values.set("local:zkas-connections", { [website]: [account] });
    await flow.pair();
    const testStorage = globalThis as typeof globalThis & {
      storage: {
        getItem(key: string): Promise<unknown>;
        setItem(key: string, value: unknown): Promise<void>;
      };
    };
    const originalGet = testStorage.storage.getItem;
    const originalSet = testStorage.storage.setItem;
    if (writeFails)
      testStorage.storage.setItem = async (key, value) => {
        if (key === "local:zkas-connections")
          throw new Error("Test connection storage failed");
        await originalSet(key, value);
      };
    let remove: Promise<void> | undefined;
    testStorage.storage.getItem = async (key: string) => {
      const value = await originalGet(key);
      if (
        key === "local:zkas-connections" &&
        !remove &&
        flow.calls.some((call) => call.path === "/api/wallet/balance")
      ) {
        remove = page.module.zkasConnectionStore.remove(website);
        void remove.catch(() => undefined);
      }
      return value;
    };
    const responses: unknown[] = [];
    try {
      await expect(
        page.module.zkasGetBalanceHandler(
          1,
          { id: "late-revoke", origin: website } as never,
          (value) => responses.push(value),
          undefined as never,
        ),
      ).rejects.toThrow();
      expect(remove).toBeDefined();
      if (writeFails) await expect(remove).rejects.toThrow(/storage failed/);
      else await remove;
      expect(responses).toHaveLength(0);
    } finally {
      page.cleanup();
      flow.cleanup();
    }
  });
}

for (const change of ["lock", "source", "selection", "permission"] as const) {
  test(`post-balance website publication rejects a changed ${change} context`, async () => {
    const flow = await fixture();
    const page = await builtCombinedPage();
    const website = "https://dapp.example";
    Object.assign(globalThis, { __reviewAccount: account });
    flow.values.set("local:zkas-connections", { [website]: [account] });
    await flow.pair();
    const testStorage = globalThis as typeof globalThis & {
      storage: { getItem(key: string): Promise<unknown> };
    };
    const originalGet = testStorage.storage.getItem;
    const dependencies = globalThis as typeof globalThis & {
      __privateDeps: { checkSelection(): Promise<void> };
    };
    const originalSelection = dependencies.__privateDeps.checkSelection;
    let changed = false;
    let selected = true;
    dependencies.__privateDeps.checkSelection = async () => {
      await originalSelection();
      if (!selected) throw new Error("Selected account changed");
    };
    testStorage.storage.getItem = async (key: string) => {
      const value = await originalGet(key);
      if (
        key === "local:zkas-connections" &&
        !changed &&
        flow.calls.some((call) => call.path === "/api/wallet/balance")
      ) {
        changed = true;
        if (change === "lock") await flow.keyring.lock();
        if (change === "source")
          flow.values.set("local:settings", {
            networkId: "mainnet",
            zkasDaemonUrls: { mainnet: "https://other.example" },
          });
        if (change === "selection") selected = false;
        if (change === "permission") flow.setPermission(false);
      }
      return value;
    };
    const responses: unknown[] = [];
    try {
      await expect(
        page.module.zkasGetBalanceHandler(
          1,
          { id: "changed", origin: website } as never,
          (value) => responses.push(value),
          undefined as never,
        ),
      ).rejects.toThrow();
      expect(changed).toBe(true);
      expect(responses).toHaveLength(0);
    } finally {
      page.cleanup();
      flow.cleanup();
    }
  });
}

for (const mutation of ["revoke", "unrelated grant"] as const) {
  test(`a ${mutation} started inside the last post-balance private check invalidates the website lease`, async () => {
    const flow = await fixture();
    const page = await builtCombinedPage();
    const website = "https://dapp.example";
    Object.assign(globalThis, { __reviewAccount: account });
    flow.values.set("local:zkas-connections", { [website]: [account] });
    await flow.pair();
    const dependencies = globalThis as typeof globalThis & {
      __privateDeps: { checkSelection(): Promise<void> };
    };
    const originalSelection = dependencies.__privateDeps.checkSelection;
    let pending: Promise<void> | undefined;
    dependencies.__privateDeps.checkSelection = async () => {
      await originalSelection();
      if (
        !pending &&
        flow.calls.some((call) => call.path === "/api/wallet/balance")
      ) {
        pending =
          mutation === "revoke"
            ? page.module.zkasConnectionStore.remove(website)
            : page.module.zkasConnectionStore.add(
                "https://other-dapp.example",
                account,
              );
      }
    };
    const responses: unknown[] = [];
    try {
      await expect(
        page.module.zkasGetBalanceHandler(
          1,
          { id: "private-race", origin: website } as never,
          (value) => responses.push(value),
          undefined as never,
        ),
      ).rejects.toThrow();
      expect(pending).toBeDefined();
      await pending;
      expect(responses).toHaveLength(0);
    } finally {
      page.cleanup();
      flow.cleanup();
    }
  });
}

test("actual internal dispatcher rejects a webpage and only the extension receives status", async () => {
  const flow = await fixture();
  const dispatcher = await builtDispatcher();
  let listener:
    | ((
        message: unknown,
        sender: unknown,
        respond: (value: unknown) => void,
      ) => boolean)
    | undefined;
  Object.assign(globalThis, {
    browser: {
      permissions: { contains: async () => true },
      runtime: {
        id: "dummy-extension",
        getURL: (path: string) => `chrome-extension://dummy-extension${path}`,
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
    },
  });
  try {
    dispatcher.module.ExtensionService.getInstance().startListening();
    expect(listener).toBeDefined();
    const message = {
      method: Method.ZKAS_DAEMON_BIRTHDAY,
      origin,
      network: "mainnet",
    };
    let rejected: unknown;
    listener!(
      message,
      { id: "dummy-extension", url: "https://page.example" },
      (value) => {
        rejected = value;
      },
    );
    expect(rejected).toMatchObject({
      error: "ZKas requests require an extension page",
    });
    expect(flow.calls).toHaveLength(0);
    const accepted = await new Promise<unknown>((resolve) => {
      listener!(
        message,
        {
          id: "dummy-extension",
          url: "chrome-extension://dummy-extension/popup.html",
        },
        resolve,
      );
    });
    expect(accepted).toEqual({ birthday: 765 });
    expect(flow.calls).toHaveLength(1);
    flow.setPermission(true);
    flow.values.set("local:settings", {
      networkId: "mainnet",
      zkasDaemonUrls: { mainnet: "" },
    });
    expect(
      await flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).toEqual({ birthday: 765 });
  } finally {
    dispatcher.cleanup();
    flow.cleanup();
  }
});

test("paired read and setup sends Bearer only to fixed routes and returns public data", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    expect(
      await flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).toEqual({ birthday: 765 });
    expect(
      await flow.invoke(flow.module.daemonRegister, {
        method: Method.ZKAS_DAEMON_REGISTER,
        expectedAccount: account,
        expectedOrigin: origin,
        birthday: 0,
      }),
    ).toEqual({ registered: true });
    expect(
      await flow.invoke(flow.module.daemonState, {
        method: Method.ZKAS_DAEMON_STATE,
        expectedAccount: account,
      }),
    ).toMatchObject({ address: account.address, balanceSompi: "42" });
    expect(
      await flow.invoke(flow.module.daemonRecentHistory, {
        method: Method.ZKAS_DAEMON_RECENT_HISTORY,
        expectedAccount: account,
      }),
    ).toMatchObject({ recoverableHistory: true, total: 0, rows: [] });
    expect(flow.calls.map((row) => row.path)).toEqual([
      "/api/status",
      "/api/status",
      "/api/wallet/watch",
      "/api/status",
      "/api/wallet/watch",
      "/api/wallet/balance",
      "/api/status",
      "/api/wallet/watch",
      "/api/wallet/balance",
      "/api/wallet/history?limit=30",
    ]);
    for (const row of flow.calls) {
      expect(row.authorization).toBe(`Bearer ${bearer}`);
      expect(row.token).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(
      flow.calls.find((row) => row.path === "/api/wallet/watch")?.body,
    ).toContain(fvk);
    expect(
      JSON.stringify(
        await flow.invoke(flow.module.daemonState, {
          method: Method.ZKAS_DAEMON_STATE,
        }),
      ),
    ).not.toContain(fvk);
  } finally {
    flow.cleanup();
  }
});

test("unpaired birthday keeps the public host-permitted probe", async () => {
  const flow = await fixture();
  try {
    expect(
      await flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).toEqual({ birthday: 765 });
    expect(flow.calls).toHaveLength(1);
    expect(flow.calls[0].authorization).toBeNull();
    flow.setPermission(false);
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).rejects.toThrow();
    expect(flow.calls).toHaveLength(1);
  } finally {
    flow.cleanup();
  }
});

test("an explicitly paired draft origin receives only its own credential", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    flow.values.set("local:settings", {
      networkId: "mainnet",
      zkasDaemonUrls: { mainnet: "https://configured.example" },
    });
    expect(
      await flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).toEqual({ birthday: 765 });
    expect(flow.calls).toMatchObject([
      { path: "/api/status", authorization: `Bearer ${bearer}` },
    ]);
    expect(flow.calls).toHaveLength(1);
  } finally {
    flow.cleanup();
  }
});

test("malformed named requests, unauthorized and oversized responses fail closed", async () => {
  const flow = await fixture();
  try {
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
        path: "/api/wallet/prepare",
      }),
    ).rejects.toThrow();
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin: `${origin}/watch`,
        network: "mainnet",
      }),
    ).rejects.toThrow();
    expect(flow.calls).toHaveLength(0);
    flow.setUnauthorized();
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).rejects.toThrow(/401/);
  } finally {
    flow.cleanup();
  }
  const tooLarge = await fixture();
  try {
    tooLarge.setOversized();
    await expect(
      tooLarge.invoke(tooLarge.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin,
        network: "mainnet",
      }),
    ).rejects.toThrow(/limit/);
  } finally {
    tooLarge.cleanup();
  }
});

test("source, permission, and lock changes after fetch suppress a success response", async () => {
  for (const change of [
    "setSourceChange",
    "setPermissionChange",
    "setLockChange",
    "setBearerChange",
  ] as const) {
    const flow = await fixture();
    try {
      if (change === "setBearerChange") await flow.pair();
      flow[change]();
      await expect(
        flow.invoke(flow.module.daemonBirthday, {
          method: Method.ZKAS_DAEMON_BIRTHDAY,
          origin,
          network: "mainnet",
        }),
      ).rejects.toThrow();
      expect(flow.calls).toHaveLength(1);
    } finally {
      flow.cleanup();
    }
  }
});

test("a new wallet birthday is preserved below tip and clipped above tip", async () => {
  const flow = await fixture();
  try {
    await flow.invoke(flow.module.daemonRegister, {
      method: Method.ZKAS_DAEMON_REGISTER,
      expectedAccount: account,
      expectedOrigin: origin,
      birthday: 700,
    });
    expect(
      JSON.parse(
        flow.calls.find((row) => row.path === "/api/wallet/watch")!.body!,
      ),
    ).toMatchObject({ birthday: 700 });
    flow.calls.length = 0;
    await flow.invoke(flow.module.daemonRegister, {
      method: Method.ZKAS_DAEMON_REGISTER,
      expectedAccount: account,
      expectedOrigin: origin,
      birthday: 900,
    });
    expect(
      JSON.parse(
        flow.calls.find((row) => row.path === "/api/wallet/watch")!.body!,
      ),
    ).toMatchObject({ birthday: 0 });
  } finally {
    flow.cleanup();
  }
});

test("wrong exact account or origin stops before network access", async () => {
  const flow = await fixture();
  try {
    await expect(
      flow.invoke(flow.module.daemonRegister, {
        method: Method.ZKAS_DAEMON_REGISTER,
        expectedAccount: { ...account, address: "zkas:other" },
        expectedOrigin: origin,
        birthday: 0,
      }),
    ).rejects.toThrow();
    await expect(
      flow.invoke(flow.module.daemonRegister, {
        method: Method.ZKAS_DAEMON_REGISTER,
        expectedAccount: account,
        expectedOrigin: "https://other.example",
        birthday: 0,
      }),
    ).rejects.toThrow();
    expect(flow.calls).toHaveLength(0);
  } finally {
    flow.cleanup();
  }
});

test("loopback HTTP enforces the exact Bearer route, status, redirect, and byte cap", async () => {
  let mode: "ok" | "unauthorized" | "redirect" | "oversized" = "ok";
  const received: { path: string; bearer?: string; token?: string }[] = [];
  const server = createServer((request, response) => {
    received.push({
      path: request.url ?? "",
      bearer: request.headers.authorization,
      token: request.headers["x-wallet-token"] as string | undefined,
    });
    if (mode === "unauthorized") {
      response.writeHead(401).end();
      return;
    }
    if (mode === "redirect") {
      response
        .writeHead(302, { Location: "https://other.example/api/status" })
        .end();
      return;
    }
    if (mode === "oversized") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end("x".repeat(16_385));
      return;
    }
    if (request.url !== "/api/status") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        has_wallet: false,
        address: null,
        network: "mainnet",
        node_connected: true,
        daa_score: 765,
        synced: true,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind");
  const loopbackOrigin = `http://127.0.0.1:${address.port}`;
  const flow = await fixture(loopbackOrigin);
  try {
    await flow.pair();
    flow.useRealFetch();
    expect(
      await flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin: loopbackOrigin,
        network: "mainnet",
      }),
    ).toEqual({ birthday: 765 });
    expect(received).toMatchObject([
      { path: "/api/status", bearer: `Bearer ${bearer}` },
    ]);
    expect(received[0].token).toMatch(/^[0-9a-f]{32}$/);
    mode = "unauthorized";
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin: loopbackOrigin,
        network: "mainnet",
      }),
    ).rejects.toThrow(/401/);
    mode = "redirect";
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin: loopbackOrigin,
        network: "mainnet",
      }),
    ).rejects.toThrow();
    mode = "oversized";
    await expect(
      flow.invoke(flow.module.daemonBirthday, {
        method: Method.ZKAS_DAEMON_BIRTHDAY,
        origin: loopbackOrigin,
        network: "mainnet",
      }),
    ).rejects.toThrow(/limit/);
    expect(received.every((row) => row.path === "/api/status")).toBe(true);
  } finally {
    flow.cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
