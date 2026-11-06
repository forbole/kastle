import { test, expect } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Kcc20Token, Kcc20Tokens } from "@/lib/kcc20";

// useKcc20Tokens.ts reaches the settings screen, the RPC context and the scan
// itself, none of which the cache needs. esbuild bundles the real module with
// those imports stubbed and wxt/storage in memory, re-exported as `store`.
type Modules = typeof import("@/lib/kcc20/useKcc20Tokens") & {
  store: Map<string, unknown>;
};

let m: Modules;

const STUB = "kcc20-holdings-stub";
const STUBS: Record<string, string> = {
  "wxt/storage": `
    export const store = new Map();
    export const storage = {
      getItem: async (k) => structuredClone(store.get(k) ?? null),
      setItem: async (k, v) => void store.set(k, structuredClone(v)),
    };`,
  "@/hooks/useSettings.ts": "export const useSettings = () => [];",
  "@/hooks/useFeatureFlags.ts": "export const useFeatureFlags = () => ({});",
  "@/contexts/RpcClientContext.tsx":
    "export const RpcClientContext = { _currentValue: {} };",
  "@/components/screens/Settings": "export const restApis = {};",
  "@/lib/kcc20": `
    export const KRON_HOSTS = {};
    export const fetchKcc20Tokens = () => { throw new Error("unused"); };`,
};
const stubs: Plugin = {
  name: STUB,
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) =>
      args.path in STUBS &&
      (args.path === "wxt/storage" ||
        args.importer.endsWith(path.join("lib", "kcc20", "useKcc20Tokens.ts")))
        ? { path: args.path, namespace: STUB }
        : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: STUB }, (args) => ({
      contents: STUBS[args.path],
      loader: "js",
    }));
  },
};

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `kcc20-holdings-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        `export * from "@/lib/kcc20/useKcc20Tokens";`,
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

test.beforeEach(() => m.store.clear());

const NET = "mainnet";
const ADDR = "kaspa:qtest";

const token = (amount: bigint): Kcc20Token =>
  ({
    covenantId: "ab".repeat(32),
    family: "kron-legacy",
    amount,
    spendable: amount,
  }) as Kcc20Token;

const scan =
  (tokens: Kcc20Token[], legacyUnavailable = false) =>
  () =>
    Promise.resolve<Kcc20Tokens>({ tokens, legacyUnavailable });

test("a complete scan is stored and read back with bigint amounts", async () => {
  await m.scanKcc20Holdings(NET, ADDR, scan([token(12n)]));
  const loaded = await m.loadKcc20Holdings(NET, ADDR);
  expect(loaded?.tokens).toHaveLength(1);
  expect(typeof loaded?.tokens[0].amount).toBe("bigint");
  expect(String(loaded?.tokens[0].amount)).toBe("12");
  // Another network or address never reads it.
  expect(await m.loadKcc20Holdings("testnet-10", ADDR)).toBeUndefined();
  expect(await m.loadKcc20Holdings(NET, "kaspa:qother")).toBeUndefined();
});

test("a failed scan rethrows and leaves the stored set untouched", async () => {
  await m.scanKcc20Holdings(NET, ADDR, scan([token(5n)]));
  const before = structuredClone([...m.store.entries()]);
  await expect(
    m.scanKcc20Holdings(NET, ADDR, () => Promise.reject(new Error("rpc down"))),
  ).rejects.toThrow("rpc down");
  expect([...m.store.entries()]).toEqual(before);
  expect(String((await m.loadKcc20Holdings(NET, ADDR))?.tokens[0].amount)).toBe(
    "5",
  );
});

test("a failed scan with nothing stored writes nothing, not an empty set", async () => {
  await expect(
    m.scanKcc20Holdings(NET, ADDR, () => Promise.reject(new Error("timeout"))),
  ).rejects.toThrow("timeout");
  expect(m.store.size).toBe(0);
});

test("a partial scan (legacy list down) is returned but never stored", async () => {
  await m.scanKcc20Holdings(NET, ADDR, scan([token(5n)]));
  const partial = await m.scanKcc20Holdings(NET, ADDR, scan([], true));
  expect(partial.tokens).toHaveLength(0);
  expect(String((await m.loadKcc20Holdings(NET, ADDR))?.tokens[0].amount)).toBe(
    "5",
  );
});
