import { test, expect } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// esbuild bundles the real module with wxt/storage in memory, re-exported as
// `store`, and a short CURRENCIES list in place of the settings context.
// fetch is replaced per test.
type Modules = typeof import("@/lib/cache/usdRatesCache") & {
  store: Map<string, unknown>;
  failWrites: (on: boolean) => void;
};

let m: Modules;

const STUB = "usd-rates-stub";
const STUBS: Record<string, string> = {
  "wxt/storage": `
    export const store = new Map();
    let writesFail = false;
    export const failWrites = (on) => { writesFail = on; };
    export const storage = {
      getItem: async (k) => structuredClone(store.get(k) ?? null),
      setItem: async (k, v) => {
        if (writesFail) throw new Error("QUOTA_BYTES quota exceeded");
        store.set(k, structuredClone(v));
      },
      removeItem: async (k) => void store.delete(k),
    };`,
  "@/contexts/SettingsContext.tsx": `
    export const CURRENCIES = [["USD"], ["EUR"], ["TWD"]];`,
};
const stubs: Plugin = {
  name: STUB,
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) =>
      args.path in STUBS ? { path: args.path, namespace: STUB } : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: STUB }, (args) => ({
      contents: STUBS[args.path],
      loader: "js",
    }));
  },
};

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `usd-rates-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        `export * from "@/lib/cache/usdRatesCache";`,
        `export { store, failWrites } from "wxt/storage";`,
      ].join("\n"),
      resolveDir: repo,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    tsconfig: path.join(repo, "tsconfig.json"),
    plugins: [stubs],
    logLevel: "error",
  });
  m = await import(pathToFileURL(outfile).href);
});

const KEY = "local:cache:usdRates";
const OLD = { eur: 0.8, twd: 30 };
const NEW = { eur: 0.9, twd: 32 };
const realFetch = globalThis.fetch;
let calls: string[];

// `answer` maps each URL to the `usd` table it returns, or null for a 500.
function mockFetch(answer: (url: string) => unknown) {
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    await new Promise((r) => setTimeout(r, 5));
    const usd = answer(url);
    return usd === null
      ? new Response("down", { status: 500 })
      : Response.json({ date: "2026-11-09", usd });
  }) as typeof fetch;
}

test.beforeEach(() => {
  m.store.clear();
  m.failWrites(false);
  calls = [];
});
test.afterAll(() => {
  globalThis.fetch = realFetch;
});

test("a cache miss fetches once for concurrent callers and stores the rates", async () => {
  mockFetch(() => NEW);
  const results = await Promise.all([1, 2, 3].map(() => m.getUsdRates()));
  expect(results).toEqual([NEW, NEW, NEW]);
  expect(calls).toHaveLength(1);
  expect(m.store.get(KEY)).toMatchObject({ rates: NEW });
});

test("fresh rates are served from the store without a fetch", async () => {
  m.store.set(KEY, { rates: OLD, fetchedAt: Date.now() - 9 * 60_000 });
  mockFetch(() => NEW);
  expect(await m.getUsdRates()).toEqual(OLD);
  expect(calls).toHaveLength(0);
});

test("rates older than 10 minutes are fetched again", async () => {
  m.store.set(KEY, { rates: OLD, fetchedAt: Date.now() - 11 * 60_000 });
  mockFetch(() => NEW);
  expect(await m.getUsdRates()).toEqual(NEW);
  expect(calls).toHaveLength(1);
});

test("the fallback source is used when the primary fails", async () => {
  mockFetch((url) => (url.includes("pages.dev") ? null : NEW));
  expect(await m.getUsdRates()).toEqual(NEW);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain("cdn.jsdelivr.net");
});

for (const [name, bad] of [
  ["an empty table", {}],
  ["a zero rate", { eur: 0, twd: 32 }],
  ["a non-numeric rate", { eur: "0.9", twd: 32 }],
  ["a missing supported currency", { eur: 0.9 }],
] as const) {
  test(`${name} is rejected and the fallback source is used`, async () => {
    mockFetch((url) => (url.includes("pages.dev") ? bad : NEW));
    expect(await m.getUsdRates()).toEqual(NEW);
    expect(m.store.get(KEY)).toMatchObject({ rates: NEW });
  });
}

test("an upstream error returns the stored rates and leaves the store as it was", async () => {
  const stale = { rates: OLD, fetchedAt: Date.now() - 60 * 60_000 };
  m.store.set(KEY, stale);
  mockFetch(() => null);
  expect(await m.getUsdRates()).toEqual(OLD);
  expect(m.store.get(KEY)).toEqual(stale);
});

test("an upstream error with nothing stored rejects and writes nothing", async () => {
  mockFetch(() => null);
  await expect(m.getUsdRates()).rejects.toThrow("Request failed: 500");
  expect(m.store.size).toBe(0);
});

test("a failed storage write still returns the fetched rates", async () => {
  m.store.set(KEY, { rates: OLD, fetchedAt: Date.now() - 11 * 60_000 });
  m.failWrites(true);
  mockFetch(() => NEW);
  expect(await m.getUsdRates()).toEqual(NEW);
});

test("invalidateUsdRates forces the next call to fetch", async () => {
  m.store.set(KEY, { rates: OLD, fetchedAt: Date.now() });
  await m.invalidateUsdRates();
  mockFetch(() => NEW);
  expect(await m.getUsdRates()).toEqual(NEW);
  expect(calls).toHaveLength(1);
});

test("invalidating during a fetch still forces the next call to fetch", async () => {
  mockFetch(() => OLD);
  const pending = m.getUsdRates();
  await expect.poll(() => calls.length).toBe(1); // the fetch is in flight
  await m.invalidateUsdRates();
  await pending;
  mockFetch(() => NEW);
  expect(await m.getUsdRates()).toEqual(NEW);
  expect(calls).toHaveLength(2);
});
