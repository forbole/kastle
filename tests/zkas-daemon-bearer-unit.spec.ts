import { expect, test } from "@playwright/test";
import { Keyring } from "@/lib/keyring-manager";
import {
  DaemonBearerStore,
  DAEMON_BEARERS_KEY,
} from "@/lib/zkas/daemon-bearer";
import { Method } from "@/lib/service/methods";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const origin = "http://localhost:8765";
const otherOrigin = "https://node.example";
const bearer = "a".repeat(64);

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

async function setup() {
  const values = testStorage();
  const keyring = new Keyring(`bearer-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  return { values, keyring, store: new DaemonBearerStore(keyring) };
}

test("the daemon bearer has a dedicated encrypted Keyring slot", () => {
  const keyring = new Keyring("daemon-bearer-test");
  expect(keyring.listKeys()).toContain("zkasDaemonBearers");
});

test("pairing exposes only named extension message operations", () => {
  expect(Method.ZKAS_DAEMON_BEARER_PAIR).toBe("ZKAS_DAEMON_BEARER_PAIR");
  expect(Method.ZKAS_DAEMON_BEARER_LIST).toBe("ZKAS_DAEMON_BEARER_LIST");
  expect(Method.ZKAS_DAEMON_BEARER_CLEAR).toBe("ZKAS_DAEMON_BEARER_CLEAR");
  expect(Object.values(Method)).not.toContain("ZKAS_DAEMON_BEARER_GET");
});

test("pairing encrypts the bearer and returns only an origin and revision", async () => {
  const { values, store } = await setup();
  const paired = await store.pair(origin, bearer, async () => undefined);
  expect(paired.origin).toBe(origin);
  expect(paired.revision).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(paired)).not.toContain(bearer);
  expect(await store.list(async () => undefined)).toEqual([paired]);
  expect(JSON.stringify([...values.values()])).not.toContain(bearer);
  expect(JSON.stringify([...values.values()])).not.toContain(origin);
  expect(
    await store.withBearer(
      origin,
      async () => undefined,
      async (value) => value,
    ),
  ).toBe(bearer);
});

test("replacement revision protects the new bearer from a stale clear", async () => {
  const { store } = await setup();
  const old = await store.pair(origin, bearer, async () => undefined);
  const latest = await store.pair(
    origin,
    "b".repeat(64),
    async () => undefined,
  );
  await expect(
    store.clear(origin, old.revision, async () => undefined),
  ).rejects.toThrow();
  expect(await store.list(async () => undefined)).toEqual([latest]);
  await store.clear(origin, latest.revision, async () => undefined);
  expect(await store.list(async () => undefined)).toEqual([]);
});

test("only canonical origins and lowercase 64-byte hex tokens can be paired", async () => {
  const { store } = await setup();
  for (const bad of [
    "http://localhost:8765/",
    "http://user:pass@localhost:8765",
    "http://localhost:8765/x",
    "http://localhost:8765?x=1",
    "http://localhost:8765#x",
    "http://public.example",
    "https://NODE.example",
    "https://node.example:443",
    "not-a-url",
    "https://node.example/" + "a".repeat(250),
  ]) {
    await expect(
      store.pair(bad, bearer, async () => undefined),
    ).rejects.toThrow();
  }
  for (const bad of [
    "A".repeat(64),
    "a".repeat(63),
    "g".repeat(64),
    "a".repeat(65),
  ]) {
    await expect(
      store.pair(origin, bad, async () => undefined),
    ).rejects.toThrow();
  }
  expect(await store.list(async () => undefined)).toEqual([]);
});

test("malformed, duplicate and over-capacity encrypted documents fail closed", async () => {
  const { keyring, store } = await setup();
  await keyring.setValue(DAEMON_BEARERS_KEY, { version: 2, records: [] });
  await expect(store.list(async () => undefined)).rejects.toThrow();
  const record = { origin, bearer, revision: crypto.randomUUID() };
  await keyring.setValue(DAEMON_BEARERS_KEY, {
    version: 1,
    records: [record, record],
  });
  await expect(store.list(async () => undefined)).rejects.toThrow();
  await keyring.setValue(DAEMON_BEARERS_KEY, { version: 1, records: [] });
  for (let n = 0; n < 8; n++)
    await store.pair(`https://node${n}.example`, bearer, async () => undefined);
  await expect(
    store.pair(otherOrigin, bearer, async () => undefined),
  ).rejects.toThrow();
});

test("lock, password rotation and reset preserve then remove encrypted pairing", async () => {
  const { keyring, store } = await setup();
  await store.pair(origin, bearer, async () => undefined);
  await keyring.lock();
  await expect(store.list(async () => undefined)).rejects.toThrow();
  expect(await keyring.unlock("dummy-password")).toBe(true);
  expect(await store.list(async () => undefined)).toHaveLength(1);
  expect(await keyring.changePassword("dummy-password", "new-password")).toBe(
    true,
  );
  await keyring.lock();
  expect(await keyring.unlock("new-password")).toBe(true);
  expect(
    await store.withBearer(
      origin,
      async () => undefined,
      async (value) => value,
    ),
  ).toBe(bearer);
  await keyring.clear();
  await expect(store.list(async () => undefined)).rejects.toThrow();
});

test("late replacement during bearer read cannot release the old secret", async () => {
  const { keyring, store } = await setup();
  await store.pair(origin, bearer, async () => undefined);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const oldGet = storage.getItem;
  storage.getItem = async (key: string) => {
    if (key.includes(DAEMON_BEARERS_KEY)) {
      entered();
      await gate;
    }
    return oldGet(key as Parameters<typeof storage.getItem>[0]);
  };
  try {
    const pending = store.withBearer(
      origin,
      async () => undefined,
      async (value) => value,
    );
    await reading;
    await keyring.setValue(DAEMON_BEARERS_KEY, { version: 1, records: [] });
    release();
    await expect(pending).rejects.toThrow();
  } finally {
    release();
    storage.getItem = oldGet;
  }
});

async function buildPairingService() {
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
    "zkasDirectActionComplete",
    "zkasDirectActionPendingGet",
    "zkasPaymentSendOrdinary",
    "zkasPaymentSendWebsite",
  ];
  const mocks: Record<string, string> = {
    "@/lib/keyring-manager.ts":
      "export class Keyring { constructor() { return globalThis.__pairingDeps.keyring; } }",
    "@/lib/auto-lock-manager.ts":
      "export class AutoLockManager { listen() {} }",
    "@/contexts/SettingsContext":
      "export const SETTINGS_KEY = 'local:settings';",
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
        name: "pairing-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /handlers\// }, (args) =>
            args.path.includes("zkas-daemon-bearer")
              ? null
              : { path: "unused-handler", namespace: "pairing-mock" },
          );
          plugin.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "pairing-mock" }
              : { path: resolve(root, `${args.path.slice(2)}.ts`) },
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "pairing-mock" },
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
  const directory = mkdtempSync(join(tmpdir(), "kastle-daemon-pairing-"));
  const file = join(directory, "service.mjs");
  writeFileSync(file, output.outputFiles[0].contents);
  stop();
  return {
    file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("actual dispatcher refuses page senders and exposes only sanitized pair/list/clear", async () => {
  const values = testStorage();
  const keyring = new Keyring(`bearer-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  values.set("local:settings", { zkasDaemonUrls: { mainnet: origin } });
  Object.assign(globalThis, { __pairingDeps: { keyring } });
  let listener:
    | ((
        message: unknown,
        sender: unknown,
        response: (value: unknown) => void,
      ) => boolean)
    | undefined;
  let permitted = true;
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
      permissions: { contains: async () => permitted },
    },
  });
  const artifact = await buildPairingService();
  try {
    const { ExtensionService, Method: LiveMethod } = await import(
      pathToFileURL(artifact.file).href
    );
    ExtensionService.getInstance().startListening();
    const trusted = { id: "test", url: "chrome-extension://test/popup.html" };
    const send = async (message: object, sender: object = trusted) =>
      new Promise<Record<string, unknown>>((resolve) => {
        expect(
          listener?.(message, sender, (value) =>
            resolve(value as Record<string, unknown>),
          ),
        ).toBe(true);
      });
    const pair = { method: LiveMethod.ZKAS_DAEMON_BEARER_PAIR, origin, bearer };
    const hostile = await send(pair, {
      id: "test",
      url: "https://chat.example",
    });
    expect(hostile.error).toBeTruthy();
    expect(
      await new DaemonBearerStore(keyring).list(async () => undefined),
    ).toEqual([]);
    const created = await send(pair);
    expect(created).toMatchObject({ origin, present: true });
    expect(JSON.stringify(created)).not.toContain(bearer);
    expect(await send({ ...pair, extra: "forbidden" })).toHaveProperty("error");
    const malformed = await send({ ...pair, bearer: "SENSITIVE-not-a-token" });
    expect(malformed).toHaveProperty("error");
    expect(JSON.stringify(malformed)).not.toContain("SENSITIVE-not-a-token");
    const listing = await send({ method: LiveMethod.ZKAS_DAEMON_BEARER_LIST });
    expect((listing.records as Array<{ origin: string }>)[0].origin).toBe(
      origin,
    );
    expect(JSON.stringify(listing)).not.toContain(bearer);
    permitted = false;
    expect(await send(pair)).toHaveProperty("error");
    permitted = true;
    let releasePermission!: () => void;
    let permissionEntered!: () => void;
    const permissionGate = new Promise<void>((resolve) => {
      releasePermission = resolve;
    });
    const enteredPermission = new Promise<void>((resolve) => {
      permissionEntered = resolve;
    });
    browser.permissions.contains = async () => {
      permissionEntered();
      await permissionGate;
      return true;
    };
    const interrupted = send({ ...pair, bearer: "b".repeat(64) });
    await enteredPermission;
    values.set("local:settings", { zkasDaemonUrls: { mainnet: otherOrigin } });
    releasePermission();
    expect(await interrupted).toHaveProperty("error");
    expect(
      (await new DaemonBearerStore(keyring).list(async () => undefined))[0]
        .revision,
    ).toBe(created.revision);
    expect(
      (
        (await send({ method: LiveMethod.ZKAS_DAEMON_BEARER_LIST }))
          .records as Array<{ sourceStatus: string }>
      )[0].sourceStatus,
    ).toBe("stale");
    expect(
      await send({
        method: LiveMethod.ZKAS_DAEMON_BEARER_CLEAR,
        origin,
        expectedRevision: "00000000-0000-4000-8000-000000000001",
      }),
    ).toHaveProperty("error");
    await send({
      method: LiveMethod.ZKAS_DAEMON_BEARER_CLEAR,
      origin,
      expectedRevision: created.revision,
    });
    expect(
      (await send({ method: LiveMethod.ZKAS_DAEMON_BEARER_LIST })).records,
    ).toEqual([]);
    values.set("local:settings", { zkasDaemonUrls: { mainnet: "" } });
    expect(await send(pair)).toMatchObject({ origin, present: true });
  } finally {
    artifact.cleanup();
  }
});

test("source changes during every permission await prevent pairing success", async () => {
  const values = testStorage();
  const keyring = new Keyring(`bearer-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  const settings = { zkasDaemonUrls: { mainnet: origin } };
  values.set("local:settings", settings);
  Object.assign(globalThis, { __pairingDeps: { keyring } });
  let listener:
    | ((
        message: unknown,
        sender: unknown,
        response: (value: unknown) => void,
      ) => boolean)
    | undefined;
  let permissionCheck = 0;
  let changeAt = 0;
  let deny = false;
  let hold: Promise<void> | undefined;
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
      permissions: {
        contains: async () => {
          permissionCheck++;
          await hold;
          if (permissionCheck === changeAt)
            values.set("local:settings", {
              zkasDaemonUrls: { mainnet: otherOrigin },
            });
          return !deny;
        },
      },
    },
  });
  const artifact = await buildPairingService();
  try {
    const { ExtensionService, Method: LiveMethod } = await import(
      pathToFileURL(artifact.file).href
    );
    ExtensionService.getInstance().startListening();
    const send = async () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const message = {
          method: LiveMethod.ZKAS_DAEMON_BEARER_PAIR,
          origin,
          bearer,
        };
        const sender = {
          id: "test",
          url: "chrome-extension://test/popup.html",
        };
        expect(
          listener?.(message, sender, (value) =>
            resolve(value as Record<string, unknown>),
          ),
        ).toBe(true);
      });
    for (const at of [1, 2, 3, 4]) {
      values.set("local:settings", settings);
      permissionCheck = 0;
      changeAt = at;
      const result = await send();
      expect(
        result,
        `source changed during permission check ${at}`,
      ).toHaveProperty("error");
      expect(permissionCheck).toBe(at);
      // A failed post-write check may leave the exact authorized old-origin row.
      expect(
        (
          await new DaemonBearerStore(keyring).list(async () => undefined)
        ).every((row) => row.origin === origin),
      ).toBe(true);
    }
    values.set("local:settings", settings);
    permissionCheck = 0;
    changeAt = 0;
    expect(await send()).toMatchObject({ origin, present: true });
    expect(permissionCheck).toBe(4);
    deny = true;
    expect(await send()).toHaveProperty("error");
    deny = false;
    let release!: () => void;
    let entered!: () => void;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    browser.permissions.contains = async () => {
      entered();
      await hold;
      return true;
    };
    const inFlight = send();
    await waiting;
    await keyring.lock();
    release();
    expect(await inFlight).toHaveProperty("error");
  } finally {
    artifact.cleanup();
  }
});
