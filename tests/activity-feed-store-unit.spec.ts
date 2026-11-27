import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// lib/activity/feed-store.ts, bundled with wxt/storage swapped for a Map:
// the stored copy must come back as the value that was stored, bigint included.
type Modules = typeof import("@/lib/activity/feed-store");
let m: Modules;
let writes: string[];

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `feed-store-unit-${process.pid}.mjs`);
  await build({
    entryPoints: [path.join(repo, "lib/activity/feed-store.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    tsconfig: path.join(repo, "tsconfig.json"),
    plugins: [
      {
        name: "storage",
        setup(b) {
          b.onResolve({ filter: /^wxt\/storage$/ }, () => ({
            path: "s",
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "js",
            contents: `const store = new Map(); globalThis.__writes = []; globalThis.__store = store;
              export const storage = {
                getItem: async (k) => store.get(k) ?? null,
                setItem: async (k, v) => { globalThis.__writes.push(k); store.set(k, v); },
              };`,
          }));
        },
      },
    ],
    logLevel: "error",
  });
  m = await import(pathToFileURL(outfile).href);
  writes = (globalThis as unknown as { __writes: string[] }).__writes;
});

test("a stored family round-trips, bigint and undefined fields included", async () => {
  const family = {
    swaps: [
      {
        id: "a",
        amount: 123456789012345678901234567890n,
        nested: { fee: 0n, label: "x" },
        missing: undefined,
      },
    ],
    health: "ok",
    unattributed: 0,
  };
  m.storeActivity("kcc20", "kaspa:q1", family);
  const back = await m.loadStoredActivity<typeof family>("kcc20", "kaspa:q1");
  // JSON drops undefined fields, as storage itself would.
  expect(back?.swaps[0].amount === family.swaps[0].amount).toBe(true);
  expect(back?.swaps[0].nested.fee === 0n).toBe(true);
  expect(m.encodeStored(back)).toBe(m.encodeStored(family));
  expect(await m.loadStoredActivity("feed", "kaspa:q1")).toBeUndefined();
});

test("an unchanged poll writes nothing; a changed one writes", () => {
  const before = writes.length;
  m.storeActivity("feed", "0xa:kaspa:q1", { items: [1] });
  m.storeActivity("feed", "0xa:kaspa:q1", { items: [1] });
  expect(writes.length - before).toBe(1);
  m.storeActivity("feed", "0xa:kaspa:q1", { items: [2] });
  expect(writes.length - before).toBe(2);
});

test("a copy under another schema's key is never restored", async () => {
  const store = (globalThis as unknown as { __store: Map<string, string> })
    .__store;
  // What 673552ec wrote: no schema segment.
  const old = m.encodeStored({ swaps: [{ id: "old-shape" }] });
  store.set("local:cache:activity:kcc20:kaspa:q9", old);
  expect(await m.loadStoredActivity("kcc20", "kaspa:q9")).toBeUndefined();
  m.storeActivity("kcc20", "kaspa:q9", { swaps: [] });
  expect(writes.at(-1)).toBe("local:cache:activity:v1:kcc20:kaspa:q9");
});
