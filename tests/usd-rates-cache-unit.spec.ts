import { test, expect } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// esbuild bundles the real module with wxt/storage in memory, re-exported as
// `store`. fetch is replaced per test.
type Modules = typeof import("@/lib/cache/usdRatesCache") & {
  store: Map<string, unknown>;
};

let m: Modules;

const STUB = "usd-rates-stub";
const stubs: Plugin = {
  name: STUB,
  setup(b) {
    b.onResolve({ filter: /^wxt\/storage$/ }, (args) => ({
      path: args.path,
      namespace: STUB,
    }));
    b.onLoad({ filter: /.*/, namespace: STUB }, () => ({
      contents: `
        export const store = new Map();
        export const storage = {
          getItem: async (k) => structuredClone(store.get(k) ?? null),
          setItem: async (k, v) => void store.set(k, structuredClone(v)),
          removeItem: async (k) => void store.delete(k),
        };`,
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
        `export { store } from "wxt/storage";`,
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
const realFetch = globalThis.fetch;
let calls: string[];

// Each URL in `fail` answers 500; every other URL answers `rates`.
function mockFetch(rates: Record<string, number>, fail: RegExp[] = []) {
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    await new Promise((r) => setTimeout(r, 5));
    return fail.some((f) => f.test(url))
      ? new Response("down", { status: 500 })
      : Response.json({ date: "2026-11-09", usd: rates });
  }) as typeof fetch;
}

test.beforeEach(() => {
  m.store.clear();
  calls = [];
});
test.afterAll(() => {
  globalThis.fetch = realFetch;
});

test("a cache miss fetches once for concurrent callers and stores the rates", async () => {
  mockFetch({ eur: 0.9 });
  const results = await Promise.all([1, 2, 3].map(() => m.getUsdRates()));
  expect(results).toEqual([{ eur: 0.9 }, { eur: 0.9 }, { eur: 0.9 }]);
  expect(calls).toHaveLength(1);
  expect(m.store.get(KEY)).toMatchObject({ rates: { eur: 0.9 } });
});

test("fresh rates are served from the store without a fetch", async () => {
  m.store.set(KEY, { rates: { eur: 0.8 }, fetchedAt: Date.now() - 9 * 60_000 });
  mockFetch({ eur: 0.9 });
  expect(await m.getUsdRates()).toEqual({ eur: 0.8 });
  expect(calls).toHaveLength(0);
});

test("rates older than 10 minutes are fetched again", async () => {
  m.store.set(KEY, { rates: { eur: 0.8 }, fetchedAt: Date.now() - 11 * 60_000 });
  mockFetch({ eur: 0.9 });
  expect(await m.getUsdRates()).toEqual({ eur: 0.9 });
  expect(calls).toHaveLength(1);
});

test("the fallback source is used when the primary fails", async () => {
  mockFetch({ eur: 0.9 }, [/pages\.dev/]);
  expect(await m.getUsdRates()).toEqual({ eur: 0.9 });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain("cdn.jsdelivr.net");
});

test("an upstream error returns the stored rates and leaves the store as it was", async () => {
  const stale = { rates: { eur: 0.8 }, fetchedAt: Date.now() - 60 * 60_000 };
  m.store.set(KEY, stale);
  mockFetch({}, [/./]);
  expect(await m.getUsdRates()).toEqual({ eur: 0.8 });
  expect(m.store.get(KEY)).toEqual(stale);
});

test("an upstream error with nothing stored rejects and writes nothing", async () => {
  mockFetch({}, [/./]);
  await expect(m.getUsdRates()).rejects.toThrow("Request failed: 500");
  expect(m.store.size).toBe(0);
});

test("invalidateUsdRates forces the next call to fetch", async () => {
  m.store.set(KEY, { rates: { eur: 0.8 }, fetchedAt: Date.now() });
  await m.invalidateUsdRates();
  mockFetch({ eur: 0.9 });
  expect(await m.getUsdRates()).toEqual({ eur: 0.9 });
  expect(calls).toHaveLength(1);
});
