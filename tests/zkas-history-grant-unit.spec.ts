import { expect, test } from "@playwright/test";
import { Keyring } from "@/lib/keyring-manager";
import type { Settings } from "@/contexts/SettingsContext";
import { readFileSync } from "node:fs";

test("history grants have a dedicated encrypted keyring slot", () => {
  const keyring = new Keyring("history-grant-test");
  expect(keyring.listKeys()).toContain("zkasHistoryGrants");
});

test("history index defaults only when mainnet setting is absent", async () => {
  const { requireHistoryIndexOrigin, historyIndexHostPattern } = await import(
    "@/lib/zkas/history-config"
  );
  const settings = {
    zkasHistoryIndexUrls: { mainnet: "http://127.0.0.1:8786" },
  } as Settings;
  expect(requireHistoryIndexOrigin(settings)).toBe("http://127.0.0.1:8786");
  expect(historyIndexHostPattern("http://127.0.0.1:8786")).toBe(
    "http://127.0.0.1/*",
  );
  expect(requireHistoryIndexOrigin({} as Settings)).toBe(
    "https://matjam.mooncake.space",
  );
  expect(() =>
    requireHistoryIndexOrigin({
      zkasHistoryIndexUrls: { mainnet: "" },
    } as Settings),
  ).toThrow();
  for (const denied of [
    "http://index.example:8786",
    "http://localhost",
    "http://localhost:80",
    "http://localhost:0",
    "http://localhost:08786",
    "http://127.0.0.1:65536",
    "http://[::1]:8786",
    "https://index.example/path",
    "https://user:pass@index.example",
    "https://index.example?query=1",
    "https://index.example#fragment",
    "https://INDEX.example",
  ]) {
    expect(() =>
      requireHistoryIndexOrigin({
        zkasHistoryIndexUrls: { mainnet: denied },
      } as Settings),
    ).toThrow();
  }
  expect(
    requireHistoryIndexOrigin({
      zkasHistoryIndexUrls: { mainnet: "https://index.example" },
    } as Settings),
  ).toBe("https://index.example");
});

test("history context pins the exact mainnet genesis and daemon", async () => {
  const { assertHistoryGenesis, canonicalHistoryDaemonOrigin } = await import(
    "@/lib/zkas/history-config"
  );
  expect(() =>
    assertHistoryGenesis(
      "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f",
    ),
  ).not.toThrow();
  expect(() => assertHistoryGenesis("0".repeat(64))).toThrow();
  expect(canonicalHistoryDaemonOrigin("http://localhost:8765")).toBe(
    "http://localhost:8765",
  );
  expect(() =>
    canonicalHistoryDaemonOrigin("http://localhost:8765/api"),
  ).toThrow();
});

test("Connect requests both source hosts from its click before switching network", () => {
  const source = readFileSync(
    new URL("../components/screens/zkas/ZKasSettings.tsx", import.meta.url),
    "utf8",
  );
  const connect = source.slice(
    source.indexOf("const save ="),
    source.indexOf("const disconnect ="),
  );
  expect(connect).toContain("getZKasDaemonOriginPattern(daemonUrl)");
  expect(connect).toContain("historyIndexHostPattern(selectedIndex)");
  expect(connect).toContain("browser.permissions.request");
  expect(connect).toContain("switchZKasNetwork(daemonUrl");
  expect(connect.indexOf("browser.permissions.request")).toBeLessThan(
    connect.indexOf("await permissionRequest"),
  );
  expect(connect.indexOf("await permissionRequest")).toBeLessThan(
    connect.indexOf("switchZKasNetwork(daemonUrl"),
  );
});

const address0 =
  "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy";
const genesis =
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";
const context = {
  audience: { kind: "website" as const, origin: "https://matjam.example" },
  walletId: "funded-wallet",
  accountIndex: 2,
  address0,
  network: "mainnet" as const,
  genesis,
  daemonUrl: "http://localhost:8765",
  indexUrl: "http://127.0.0.1:8786",
};

function testStorage(onRead?: (key: string) => Promise<void>) {
  const values = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => {
        await onRead?.(key);
        return values.get(key) ?? null;
      },
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

test("encrypted grant binds exact context and rejects ordinary account connection", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  const values = testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const session = keyring.getSessionVersion();
  const current = async () => undefined;
  expect(await store.active(context, "not-a-revision", session, current)).toBe(
    false,
  );
  const revision = await store.approve(context, current);
  expect(JSON.stringify([...values.values()])).not.toContain(
    context.audience.origin,
  );
  expect(JSON.stringify([...values.values()])).not.toContain(address0);
  expect(await store.active(context, revision, session, current)).toBe(true);
  for (const changed of [
    { ...context, walletId: "other" },
    { ...context, accountIndex: 0 },
    { ...context, address0: "zkas:" + "a".repeat(79) },
    { ...context, daemonUrl: "http://localhost:8766" },
    { ...context, indexUrl: "http://127.0.0.1:8787" },
    {
      ...context,
      audience: { kind: "website" as const, origin: "https://else.example" },
    },
    { ...context, audience: { kind: "walletSelf" as const } },
  ]) {
    expect(await store.active(changed, revision, session, current)).toBe(false);
  }
  await store.revoke(context);
  expect(await store.active(context, revision, session, current)).toBe(false);
});

test("grant reads fail closed after lock or changing live selection", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const revision = await store.approve(context, async () => undefined);
  const session = keyring.getSessionVersion();
  let selected = context.walletId;
  const assertCurrent = async () => {
    if (selected !== context.walletId) throw new Error("Selection changed");
  };
  expect(await store.active(context, revision, session, assertCurrent)).toBe(
    true,
  );
  selected = "other";
  await expect(
    store.active(context, revision, session, assertCurrent),
  ).rejects.toThrow();
  selected = context.walletId;
  await keyring.lock();
  expect(await store.active(context, revision, session, assertCurrent)).toBe(
    false,
  );
  expect(await keyring.unlock("test-password")).toBe(true);
  expect(await store.active(context, revision, session, assertCurrent)).toBe(
    false,
  );
});

test("malformed or extended encrypted grant documents never authorize", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const revision = await store.approve(context, async () => undefined);
  const session = keyring.getSessionVersion();
  const original =
    await keyring.getValue<Record<string, unknown>>("zkasHistoryGrants");
  for (const invalid of [
    { ...original, version: 2 },
    { ...original, extra: "unknown" },
    {
      ...original,
      records: [{ ...(original?.records as object[])[0], bearer: "secret" }],
    },
    {
      ...original,
      records: [
        (original?.records as object[])[0],
        (original?.records as object[])[0],
      ],
    },
  ]) {
    await keyring.setValue("zkasHistoryGrants", invalid);
    await expect(
      store.active(context, revision, session, async () => undefined),
    ).rejects.toThrow();
  }
  await keyring.setValue("zkasHistoryGrants", original);
  expect(
    await store.active(context, revision, session, async () => undefined),
  ).toBe(true);
});

test("overlapping revoke rejects pending approval, while a fresh approval changes revision", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const first = await store.approve(context, async () => undefined);
  const [revoke, reapprove] = await Promise.allSettled([
    store.revoke(context),
    store.approve(context, async () => undefined),
  ]);
  expect(revoke.status).toBe("fulfilled");
  expect(reapprove.status).toBe("rejected");
  const second = await store.approve(context, async () => undefined);
  expect(second).not.toBe(first);
  expect(
    await store.active(
      context,
      first,
      keyring.getSessionVersion(),
      async () => undefined,
    ),
  ).toBe(false);
  expect(
    await store.active(
      context,
      second,
      keyring.getSessionVersion(),
      async () => undefined,
    ),
  ).toBe(true);
});

test("a completed revoke or direct removal invalidates a decrypted grant before active returns", async () => {
  const { HistoryGrantStore, HISTORY_GRANTS_KEY } = await import(
    "@/lib/zkas/history-grant"
  );
  for (const removal of ["revoke", "remove"] as const) {
    testStorage();
    const keyring = new Keyring(`history-${crypto.randomUUID()}`);
    await keyring.initialize("test-password");
    const store = new HistoryGrantStore(keyring);
    const revision = await store.approve(context, async () => undefined);
    const session = keyring.getSessionVersion();
    let reachedFinal!: () => void;
    let releaseFinal!: () => void;
    const finalReached = new Promise<void>(
      (resolve) => (reachedFinal = resolve),
    );
    const finalHeld = new Promise<void>((resolve) => (releaseFinal = resolve));
    let assertions = 0;
    const active = store.active(context, revision, session, async () => {
      if (++assertions === 2) {
        reachedFinal();
        await finalHeld;
      }
    });
    await finalReached;
    if (removal === "revoke") await store.revoke(context);
    else await keyring.removeValue(HISTORY_GRANTS_KEY);
    releaseFinal();
    expect(await active).toBe(false);
  }
});

test("a revoke completed during approval's first context check prevents resurrection", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  let reachedFirst!: () => void;
  let releaseFirst!: () => void;
  const firstReached = new Promise<void>((resolve) => (reachedFirst = resolve));
  const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
  let assertions = 0;
  const approval = store.approve(context, async () => {
    if (++assertions === 1) {
      reachedFirst();
      await firstHeld;
    }
  });
  await firstReached;
  await store.revoke(context);
  releaseFirst();
  await expect(approval).rejects.toThrow("changed");
  expect(await keyring.getValue("zkasHistoryGrants")).toEqual({
    version: 1,
    records: [],
  });
});

test("grant generations follow key writes, not unrelated encrypted wallet updates", async () => {
  const { HistoryGrantStore, HISTORY_GRANTS_KEY } = await import(
    "@/lib/zkas/history-grant"
  );
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const firstStore = new HistoryGrantStore(keyring);
  const secondStore = new HistoryGrantStore(keyring);
  const revision = await firstStore.approve(context, async () => undefined);
  const session = keyring.getSessionVersion();
  const initial = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
  await keyring.setValue("wallets", []);
  expect(keyring.getMutationGeneration(HISTORY_GRANTS_KEY)).toBe(initial);
  expect(
    await secondStore.active(context, revision, session, async () => undefined),
  ).toBe(true);
  await keyring.setValue(HISTORY_GRANTS_KEY, { version: 1, records: [] });
  expect(keyring.getMutationGeneration(HISTORY_GRANTS_KEY)).toBe(initial + 1);
  expect(
    await firstStore.active(context, revision, session, async () => undefined),
  ).toBe(false);
});

test("password rotation and clear advance the grant generation", async () => {
  const { HistoryGrantStore, HISTORY_GRANTS_KEY } = await import(
    "@/lib/zkas/history-grant"
  );
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("first-password");
  const store = new HistoryGrantStore(keyring);
  await store.approve(context, async () => undefined);
  const beforeRotation = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
  expect(
    await keyring.changePassword("first-password", "second-password"),
  ).toBe(true);
  const afterRotation = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
  expect(afterRotation).toBeGreaterThan(beforeRotation);
  await keyring.clear();
  expect(keyring.getMutationGeneration(HISTORY_GRANTS_KEY)).toBeGreaterThan(
    afterRotation,
  );
  expect(keyring.isUnlocked()).toBe(false);
});

test("wallet-self read audience is distinct from every website", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const self = { ...context, audience: { kind: "walletSelf" as const } };
  const revision = await store.approve(self, async () => undefined);
  const session = keyring.getSessionVersion();
  expect(
    await store.active(self, revision, session, async () => undefined),
  ).toBe(true);
  expect(
    await store.active(context, revision, session, async () => undefined),
  ).toBe(false);
});

test("a lock during encrypted grant read cannot leave an active lease", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  let signalRead: (() => void) | undefined;
  let releaseRead: (() => void) | undefined;
  const reading = new Promise<void>((resolve) => {
    signalRead = resolve;
  });
  const held = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let holdGrantRead = false;
  testStorage(async (key) => {
    if (holdGrantRead && key.includes("zkasHistoryGrants")) {
      signalRead?.();
      await held;
    }
  });
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const revision = await store.approve(context, async () => undefined);
  const session = keyring.getSessionVersion();
  holdGrantRead = true;
  const check = store.active(context, revision, session, async () => undefined);
  await reading;
  await keyring.lock();
  releaseRead?.();
  expect(await check).toBe(false);
});

test("history grants survive password rotation without exposing records", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  const values = testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("first-password");
  const store = new HistoryGrantStore(keyring);
  const revision = await store.approve(context, async () => undefined);
  expect(
    await keyring.changePassword("first-password", "second-password"),
  ).toBe(true);
  await keyring.lock();
  expect(await keyring.unlock("second-password")).toBe(true);
  expect(
    await store.active(
      context,
      revision,
      keyring.getSessionVersion(),
      async () => undefined,
    ),
  ).toBe(true);
  expect(JSON.stringify([...values.values()])).not.toContain(
    context.audience.origin,
  );
});

test("separate origin approvals are retained and either may be revoked", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  const other = {
    ...context,
    audience: { kind: "website" as const, origin: "https://second.example" },
  };
  const first = await store.approve(context, async () => undefined);
  const second = await store.approve(other, async () => undefined);
  const session = keyring.getSessionVersion();
  expect(
    await store.active(context, first, session, async () => undefined),
  ).toBe(true);
  expect(
    await store.active(other, second, session, async () => undefined),
  ).toBe(true);
  await store.revoke(context);
  expect(
    await store.active(context, first, session, async () => undefined),
  ).toBe(false);
  expect(
    await store.active(other, second, session, async () => undefined),
  ).toBe(true);
});

test("grant mutation rejects unknown credentials and mismatched genesis", async () => {
  const { HistoryGrantStore } = await import("@/lib/zkas/history-grant");
  testStorage();
  const keyring = new Keyring(`history-${crypto.randomUUID()}`);
  await keyring.initialize("test-password");
  const store = new HistoryGrantStore(keyring);
  await expect(
    store.approve(
      { ...context, bearer: "secret" } as typeof context,
      async () => undefined,
    ),
  ).rejects.toThrow();
  await expect(
    store.approve(
      { ...context, genesis: "0".repeat(64) },
      async () => undefined,
    ),
  ).rejects.toThrow();
  expect(await keyring.getValue("zkasHistoryGrants")).toBeNull();
});
